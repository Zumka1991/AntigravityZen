package room

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

func init() {
	defaultBotRoomNames = generateRoomNames()
}

// generateRoomNames builds the full pool of room titles by combining every
// adjective with every noun (matching gender agreement), and merges in the
// fixed curated set. De-duplicates so we don't ship overlapping entries.
func generateRoomNames() []string {
	seen := make(map[string]bool, 256)
	out := make([]string, 0, 256)
	add := func(name string) {
		if seen[name] {
			return
		}
		seen[name] = true
		out = append(out, name)
	}
	for _, a := range roomNameAdjectivesF {
		for _, n := range roomNameNounsF {
			add(a + " " + n)
		}
	}
	for _, a := range roomNameAdjectivesM {
		for _, n := range roomNameNounsM {
			add(a + " " + n)
		}
	}
	for _, n := range fixedRoomNames {
		add(n)
	}
	return out
}

// defaultBotNames are the usernames we provision for seeded activity. The
// shapes are deliberately diverse — short one-word names, concatenated
// words, names with one trailing digit, camelCase — so a fresh bot account
// reads like a person who happened to pick a quiet meditation nickname.
// Underscores and dashes are intentionally avoided because new users tend to
// only use them when copying a system prompt.
var defaultBotNames = []string{
	// single-word lowercase
	"lila", "mira", "kai", "finn", "iris", "reed", "aria", "noah", "sora",
	"pema", "tessa", "sasha", "jude", "owen", "ella", "lev", "rumi", "milo",
	"yara", "noor",
	// concatenated short
	"nightwhisper", "softbreeze", "slowpath", "stillwater", "willowsage",
	"midnightowl", "cedarwind",
	// with one trailing digit, very common online
	"lila92", "kai07", "finn93", "reed95", "aria98", "noah88", "sora91",
	// camelCase, Reddit/GitHub-leaning
	"QuietMeadow", "SlowRiver", "SoftBreeze", "NightWhisper", "DistantBell",
}

// defaultBotRoomNames are the human-readable room titles a bot picks at
// random when starting a new session. They are generated once at startup
// from the adjective + noun pools below into ~hundreds of unique combinations
// so that even with daily churn two rooms almost never share a title. A
// short "recently used" buffer avoids repeats within a short window.
var defaultBotRoomNames []string

var roomNameAdjectivesF = []string{
	"Тихая", "Мягкая", "Дальняя", "Снежная", "Лунная", "Утренняя",
	"Вечерняя", "Лесная", "Стеклянная", "Каменная", "Тёплая",
	"Серебряная", "Золотая", "Звёздная", "Безымянная", "Спокойная",
	"Хрустальная", "Белая", "Серая", "Синяя", "Тёмная", "Светлая",
	"Высокая", "Низкая", "Долгая", "Короткая", "Чистая", "Звонкая",
	"Старая", "Новая", "Первая", "Последняя", "Северная", "Западная",
	"Восточная", "Южная", "Внутренняя", "Внешняя",
}

var roomNameNounsF = []string{
	"роща", "поляна", "гавань", "чаща", "низина", "долина",
	"тропа", "заводь", "река", "пристань", "часовня", "рощица",
	"ложбина", "полянка", "нива", "круча", "грива", "пойма",
	"пуща", "кедровка", "сосна", "ель", "берёзка", "ива",
	"маковица", "калина", "липа", "черёмуха", "рябина", "сирень",
}

var roomNameAdjectivesM = []string{
	"Дальний", "Полночный", "Свечной", "Тихий", "Медный", "Утренний",
	"Зимний", "Снежный", "Летний", "Осенний", "Весенний", "Ночной",
	"Дневной", "Вечерний", "Лунный", "Звёздный", "Северный", "Южный",
	"Восточный", "Западный", "Золотой", "Серебряный", "Медленный",
	"Быстрый", "Старый", "Новый", "Тихий", "Далёкий", "Близкий",
}

var roomNameNounsM = []string{
	"звон", "сад", "огонь", "час", "свет", "лес", "пик", "шёпот",
	"ручей", "перекат", "порог", "перевал", "хребет", "залив",
	"мыс", "утёс", "склон", "обрыв", "берег", "закат",
	"восход", "шёпот", "вдох", "выдох", "путь", "след",
	"свет","тёзка", "троп", "предел", "покров", "уговор",
}

// fixedRoomNames are pre-curated names that don't fit the adjective/noun
// template. They get mixed in verbatim to keep a few evocative staples from
// drifting every release.
var fixedRoomNames = []string{
	"Тихая роща", "Вечерний прибой", "Дальний звон", "Зеркальное озеро",
	"Лесной шёпот", "Свет фонаря", "Медленное дыхание", "Открытое небо",
	"Внутренний прилив", "Утренний туман", "Снежная поляна", "Тихая гавань",
	"Прозрачный ручей", "Полуночный сад", "Каменный берег", "Медный горизонт",
	"Тихий колокол", "Спокойный свет", "Раннее солнце", "Синяя тень",
}

// spectatorsPerHost sets how many extra bot accounts join each host bot's
// room as ordinary participants (not hosts). Picking randomly within
// [min, max] keeps the lobby from looking uniform — some rooms show 2,
// some show 4. 0 disables spectator mode entirely.
const (
	spectatorMinPerRoom = 1
	spectatorMaxPerRoom = 3
	// How many recently used room names to avoid in the round-robin. With
	// ~300+ names in the pool the steady-state collision probability is
	// already tiny; this buffer just makes back-to-back rooms feel even
	// less repetitive.
	recentRoomNameWindow = 24
)

// Long-track threshold (in seconds): when the chosen track exceeds this, the
// bot will enable the "use track duration" mode in the room so the meditation
// matches the audio length instead of an arbitrary timer.
const botTrackDurationThresholdSec = 20 * 60

// Min/max meditation length for bot sessions (seconds). The upper bound is
// intentionally under the typical 2-hour cap so the bot finishes its session
// before peers would naturally leave.
const (
	botMinDurationSec = 5 * 60
	botMaxDurationSec = 45 * 60
)

// Bot scheduler constants. The ticker keeps state fresh; how often we *try*
// to start new sessions to hit the configured target.
const (
	botSchedulerInterval     = 30 * time.Second
	botStartupJitterMaxSec   = 8
	botPostSessionDelaySec   = 4
	botRoomIDPrefix          = "bot_"
	botAccessEndpointTimeout = 8 * time.Second
	// Tick-time spawn policy. Each tick rolls once and only spawns at most
	// delta (1 or 2) new rooms, even if target allows many more. Over time
	// the lobby drifts up and down naturally instead of pinballing between
	// "0 rooms" and "exactly 5".
	botSpawnSkipChance   = 0.10
	botSpawnDoubleChance = 0.15
	// Per-bot rate limit: a single bot may host at most one meditation per
	// this window. Spectator joins don't count, so individual bots can keep
	// drifting through other rooms as participants.
	botDailyHostLimit = 24 * time.Hour
	// Lobby wait: every freshly created bot room sits in "lobby" /
	// "waiting for host" mode for a few minutes before the host bot sends
	// the start command. Mirrors what a real person looks like — you open
	// a room, set a few things up, then go once somebody joins (or the
	// timer runs out). The wait window is fixed at 5–10 minutes; if a
	// real user enters during this window the bot kicks off immediately,
	// otherwise it starts the meditation on its own.
	botWaitModeChance    = 1.0
	botWaitMinSeconds    = 300 // 5 min
	botWaitMaxSeconds    = 600 // 10 min
	botWaitPreStartDelay = 600 * time.Millisecond
)

// BotManager keeps the seeded community alive. It owns bot accounts, rotates
// session tokens, and schedules meditation rooms without exposing any
// "this is a bot" hint to the outside world.
type BotManager struct {
	auth    *AuthManager
	hub     *Hub

	mu             sync.Mutex
	activeSessions map[string]string // roomID -> bot username currently occupying it
	cancel         context.CancelFunc
	wg             sync.WaitGroup
	rng            *rand.Rand
}

// NewBotManager wires up bot accounts and returns a manager ready to Start.
// idledUntilStart is the very first time we wait before spawning a session.
func NewBotManager(auth *AuthManager, hub *Hub) *BotManager {
	bm := &BotManager{
		auth:           auth,
		hub:            hub,
		activeSessions: make(map[string]string),
		rng:            rand.New(rand.NewSource(time.Now().UnixNano())),
	}
	for _, name := range defaultBotNames {
		if err := auth.CreateBotUser(name); err != nil {
			log.Printf("BotManager: failed to seed bot account %q: %v", name, err)
		}
	}
	return bm
}

// Start launches the scheduler goroutine. Idempotent on repeated calls.
// Pass the parent context to halt the scheduler on shutdown.
func (bm *BotManager) Start(ctx context.Context) {
	bm.mu.Lock()
	if bm.cancel != nil {
		bm.mu.Unlock()
		return
	}
	cancelCtx, cancel := context.WithCancel(ctx)
	bm.cancel = cancel
	bm.mu.Unlock()

	bm.wg.Add(1)
	go bm.run(cancelCtx)
}

// Stop halts the scheduler and waits for in-flight bot sessions to drain. Safe
// to call multiple times.
func (bm *BotManager) Stop() {
	bm.mu.Lock()
	cancel := bm.cancel
	bm.cancel = nil
	bm.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	bm.wg.Wait()
}

// Sessions returns a snapshot of currently active bot rooms, mapped from
// roomID to bot username. Used by admin endpoints.
func (bm *BotManager) Sessions() map[string]string {
	bm.mu.Lock()
	defer bm.mu.Unlock()
	out := make(map[string]string, len(bm.activeSessions))
	for roomID, bot := range bm.activeSessions {
		out[roomID] = bot
	}
	return out
}

func (bm *BotManager) run(ctx context.Context) {
	defer bm.wg.Done()
	// Try to fill the target immediately after startup so empty lobbies don't
	// stay empty. Re-check on every tick thereafter.
	bm.tick(ctx)
	ticker := time.NewTicker(botSchedulerInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			bm.tick(ctx)
		}
	}
}

func (bm *BotManager) tick(ctx context.Context) {
	if !SettingBool(SettingBotsEnabled, false) {
		return
	}
	target := SettingInt(SettingBotsMaxConcurrent, 0)
	if target <= 0 {
		return
	}

	bm.mu.Lock()
	currentCount := len(bm.activeSessions)
	bm.mu.Unlock()
	if currentCount >= target {
		return
	}

	// Stochastic spawn: most ticks fill exactly one slot, sometimes none,
	// rarely two. The 24h per-bot rate limit makes most ticks find no
	// eligible bot anyway, so this knob is gentle — just enough to avoid
	// the "every tick spawns a bot" mechanical look.
	if bm.rng.Float64() < botSpawnSkipChance {
		return
	}
	delta := 1
	if currentCount+2 <= target && bm.rng.Float64() < botSpawnDoubleChance {
		delta = 2
	}

	occupied := bm.occupiedBots()
	for i := 0; i < delta; i++ {
		if ctx.Err() != nil {
			return
		}
		if len(bm.occupiedBots()) >= target {
			return
		}
		host := bm.pickEligibleHostBot(defaultBotNames, occupied)
		if host == "" {
			return
		}
		occupied[host] = true
		bm.wg.Add(1)
		go bm.runHostBot(ctx, host)
	}
}

// pickEligibleHostBot returns a bot that is (a) not already in the occupied
// set, and (b) has not hosted a meditation within botDailyHostLimit. Random
// ordering means any one of the eligible bots can win the slot, not always
// the same one.
func (bm *BotManager) pickEligibleHostBot(names []string, occupied map[string]bool) string {
	cutoffMs := time.Now().UnixMilli() - botDailyHostLimit.Milliseconds()
	eligible := make([]string, 0, len(names))
	for _, n := range names {
		if occupied[n] {
			continue
		}
		ts, err := bm.auth.BotLastHostedAt(n)
		if err != nil || ts >= cutoffMs {
			continue
		}
		eligible = append(eligible, n)
	}
	if len(eligible) == 0 {
		return ""
	}
	return eligible[bm.rng.Intn(len(eligible))]
}

func (bm *BotManager) occupiedBots() map[string]bool {
	bm.mu.Lock()
	defer bm.mu.Unlock()
	out := make(map[string]bool, len(bm.activeSessions))
	for _, bot := range bm.activeSessions {
		out[bot] = true
	}
	return out
}

// runHostBot starts a complete meditation session for a single bot: reserve a
// room, pick random track/background/duration, connect, send `start`, wait
// for the meditation to end, then leave. Once the room is live we also kick
// off 1–3 spectator bots so the lobby looks populated instead of having
// exactly one avatar per room. About a third of the time the bot waits in
// "lobby" mode for 3–12 minutes before sending `start`, just like a real
// person who opened the room, tabbed over, and started when somebody joined.
//
// Errors are logged but never return — the scheduler will retry on the next
// tick.
func (bm *BotManager) runHostBot(ctx context.Context, botUsername string) {
	defer bm.wg.Done()

	// Slight jitter so two bots spawned in the same tick don't race each
	// other into the same room ID prefix within the same millisecond.
	jitter := time.Duration(bm.rng.Intn(botStartupJitterMaxSec)) * time.Second
	select {
	case <-time.After(jitter):
	case <-ctx.Done():
		return
	}

	session := bm.pickSession()
	if session == nil {
		log.Printf("BotManager: %q could not assemble a session (no tracks/backgrounds)", botUsername)
		return
	}

	roomID := randomBotRoomID(bm.rng)
	roomName := bm.pickRoomName()
	track := session.track
	durationSec := session.duration
	backgroundID := session.backgroundID

	bm.mu.Lock()
	if _, exists := bm.activeSessions[roomID]; exists {
		bm.mu.Unlock()
		return
	}
	bm.activeSessions[roomID] = botUsername
	bm.mu.Unlock()
	defer bm.removeSession(roomID)

	token, err := bm.auth.EnsureBotSession(botUsername)
	if err != nil {
		log.Printf("BotManager: %q session token failed: %v", botUsername, err)
		return
	}

	clientID := randomBotClientID(bm.rng)
	_, wsScheme, wsHost, err := bm.resolveSelfURL()
	if err != nil {
		log.Printf("BotManager: self-URL resolution failed: %v", err)
		return
	}

	// Bots open the websocket directly without /api/rooms/access — that
	// matches the user flow for unprotected rooms and sidesteps the
	// "password must be at least 4 characters" rule that the hub enforces
	// only on the access endpoint. The hub will create the room in memory
	// on the first register, just as it does for any human user.
	conn, err := bm.dialWebsocket(wsScheme, wsHost, roomID, token, clientID, roomName, durationSec, track.ID, backgroundID, "")
	if err != nil {
		log.Printf("BotManager: %q websocket dial failed for %s: %v", botUsername, roomID, err)
		return
	}
	defer conn.Close()

	// Mark the bot as hosting NOW (before any wait) so the rate-limit
	// scheduler skips this name for the next botDailyHostLimit. If anything
	// afterwards fails we still consumed the slot — which is fine, the bot
	// simply doesn't host again until tomorrow.
	if err := bm.auth.MarkBotHosted(botUsername, time.Now().UnixMilli()); err != nil {
		log.Printf("BotManager: %q failed to mark hosted: %v", botUsername, err)
	}

	// Decide whether this room starts immediately or waits for participants.
	// When in wait mode we start a background watcher that signals the moment
	// a non-bot user shows up in the room; otherwise we just fall back to
	// the timeout.
	humanJoined := make(chan struct{}, 1)
	go func() {
		bm.watchForHuman(conn, humanJoined)
	}()

	waitMode := bm.rng.Float64() < botWaitModeChance
	if waitMode {
		waitSeconds := botWaitMinSeconds + bm.rng.Intn(botWaitMaxSeconds-botWaitMinSeconds+1)
		log.Printf("BotManager: %q enters wait mode in %s (%ds) until somebody joins", botUsername, roomID, waitSeconds)
		select {
		case <-humanJoined:
			log.Printf("BotManager: %q start trigger: human joined %s", botUsername, roomID)
		case <-time.After(time.Duration(waitSeconds) * time.Second):
			log.Printf("BotManager: %q start trigger: wait timeout in %s", botUsername, roomID)
		case <-ctx.Done():
			return
		}
	} else {
		// Allow a brief moment for the room_state handshake to propagate
		// before we send `start`, otherwise the host transition can be racy.
		select {
		case <-time.After(botWaitPreStartDelay):
		case <-ctx.Done():
			return
		}
	}

	startPayload, _ := json.Marshal(map[string]any{
		"trackId":      track.ID,
		"duration":     durationSec,
		"voiceTrackId": "",
	})
	if err := conn.WriteMessage(websocket.TextMessage, mustEncode(map[string]any{
		"type":    "start",
		"payload": json.RawMessage(startPayload),
	})); err != nil {
		log.Printf("BotManager: %q start failed in %s: %v", botUsername, roomID, err)
		return
	}

	log.Printf("BotManager: %q started room %s (%q, %ds, track=%s)", botUsername, roomID, roomName, durationSec, track.ID)

	// Schedule spectator bots to drift into the room a few seconds after the
	// session starts. Each spectator connects, sits idle (no `start` sent),
	// and leaves near session end. Random count and staggered join times
	// make the room look like it has a few regulars meditating together.
	if spectatorMaxPerRoom > 0 {
		count := spectatorMinPerRoom + bm.rng.Intn(spectatorMaxPerRoom-spectatorMinPerRoom+1)
		used := map[string]bool{botUsername: true}
		for i := 0; i < count; i++ {
			spectator := pickUniqueBot(defaultBotNames, used)
			if spectator == "" {
				break
			}
			used[spectator] = true
			joinDelay := 4 + bm.rng.Intn(20)
			linger := time.Duration(durationSec)*time.Second - time.Duration(joinDelay)*time.Second + botPostSessionDelaySec*time.Second
			if linger < 30*time.Second {
				linger = 30 * time.Second
			}
			bm.wg.Add(1)
			go bm.runSpectatorBot(ctx, spectator, roomID, roomName, track.ID, backgroundID, wsScheme, wsHost, joinDelay, linger)
		}
	}

	// Wait for the meditation to finish plus a small post-session delay
	// before we close the socket, mirroring how a user would naturally
	// linger briefly before leaving.
	wait := time.Duration(durationSec)*time.Second + botPostSessionDelaySec*time.Second
	select {
	case <-time.After(wait):
	case <-ctx.Done():
		return
	}

	// Best-effort leave: tell the hub we're leaving politely. The deferred
	// conn.Close() will trigger the final Unregister either way.
	leaveMsg := mustEncode(map[string]any{"type": "leave", "payload": map[string]any{}})
	deadline := time.Now().Add(2 * time.Second)
	_ = conn.SetWriteDeadline(deadline)
	_ = conn.WriteMessage(websocket.TextMessage, leaveMsg)
}

// watchForHuman reads room_state messages on conn and signals through
// humanJoined the first time it sees a non-bot participant in the room.
// The watcher exits when the connection drops.
func (bm *BotManager) watchForHuman(conn *websocket.Conn, humanJoined chan<- struct{}) {
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var msg Message
		if json.Unmarshal(raw, &msg) != nil || msg.Type != "room_state" {
			continue
		}
		var state RoomState
		if json.Unmarshal(msg.Payload, &state) != nil {
			continue
		}
		for _, c := range state.Clients {
			if c.IsHost {
				continue
			}
			if bm.auth.IsUserBot(c.Username) {
				continue
			}
			select {
			case humanJoined <- struct{}{}:
			default:
			}
			return
		}
	}
}

// runSpectatorBot connects an additional bot account to an existing room as a
// regular participant. It does NOT send `start` — the host already owns the
// meditation — and disconnects shortly before the host is scheduled to leave
// so the room doesn't empty out abruptly.
func (bm *BotManager) runSpectatorBot(ctx context.Context, botUsername, roomID, roomName, trackID, backgroundID, wsScheme, wsHost string, joinDelaySec int, linger time.Duration) {
	defer bm.wg.Done()

	select {
	case <-time.After(time.Duration(joinDelaySec) * time.Second):
	case <-ctx.Done():
		return
	}

	// Skip if the host has already left (room is closing) or the room was
	// removed by cleanup while we were waiting to join.
	bm.mu.Lock()
	_, stillActive := bm.activeSessions[roomID]
	bm.mu.Unlock()
	if !stillActive {
		return
	}

	token, err := bm.auth.EnsureBotSession(botUsername)
	if err != nil {
		return
	}
	clientID := randomBotClientID(bm.rng)
	conn, err := bm.dialWebsocket(wsScheme, wsHost, roomID, token, clientID, roomName, 0, trackID, backgroundID, "")
	if err != nil {
		return
	}
	defer conn.Close()

	log.Printf("BotManager: %q joined room %s as spectator", botUsername, roomID)

	select {
	case <-time.After(linger):
	case <-ctx.Done():
	case <-connClosed(conn):
		return
	}

	leaveMsg := mustEncode(map[string]any{"type": "leave", "payload": map[string]any{}})
	deadline := time.Now().Add(2 * time.Second)
	_ = conn.SetWriteDeadline(deadline)
	_ = conn.WriteMessage(websocket.TextMessage, leaveMsg)
}

// connClosed returns a channel that closes when the websocket's underlying
// connection drops (e.g. because the hub closed the room). We use it to let
// spectator goroutines exit early when their host is gone.
func connClosed(conn *websocket.Conn) <-chan struct{} {
	ch := make(chan struct{})
	go func() {
		defer close(ch)
		// ReadMessage returns when the peer closes; we discard the data.
		for {
			if _, _, err := conn.NextReader(); err != nil {
				return
			}
		}
	}()
	return ch
}

func (bm *BotManager) removeSession(roomID string) {
	bm.mu.Lock()
	delete(bm.activeSessions, roomID)
	bm.mu.Unlock()
}

// recentRoomNames tracks the last N room titles picked, so the lobby doesn't
// repeat a name twice in a row. Mutated under bm.mu; readers from pickRoomName
// share the same lock.
var recentRoomNames []string

func (bm *BotManager) pickRoomName() string {
	if len(defaultBotRoomNames) == 0 {
		return ""
	}
	bm.mu.Lock()
	defer bm.mu.Unlock()
	recent := make(map[string]bool, len(recentRoomNames))
	for _, n := range recentRoomNames {
		recent[n] = true
	}
	// Try a few times to find a name that isn't recent. With a 250+ pool and
	// a 24-slot recent buffer, the chance of missing is small but
	// non-zero — fall back to "any" if we run out.
	for attempt := 0; attempt < 6; attempt++ {
		pick := defaultBotRoomNames[bm.rng.Intn(len(defaultBotRoomNames))]
		if !recent[pick] {
			recentRoomNames = append(recentRoomNames, pick)
			if len(recentRoomNames) > recentRoomNameWindow {
				recentRoomNames = recentRoomNames[len(recentRoomNames)-recentRoomNameWindow:]
			}
			return pick
		}
	}
	// All draws hit recent: pick any (still random, just not de-duplicated).
	pick := defaultBotRoomNames[bm.rng.Intn(len(defaultBotRoomNames))]
	recentRoomNames = append(recentRoomNames, pick)
	if len(recentRoomNames) > recentRoomNameWindow {
		recentRoomNames = recentRoomNames[len(recentRoomNames)-recentRoomNameWindow:]
	}
	return pick
}

// pickSession picks a random background + a random ambient track, and decides
// whether to lock duration to the track length. Returns nil if either pool is
// empty.
func (bm *BotManager) pickSession() *botSession {
	tracks := GetTracks()
	ambients := make([]Track, 0, len(tracks))
	for _, t := range tracks {
		// Voice tracks are owned by a real user; bots stick to public ambient
		// soundscapes so they don't drown out human-recorded sessions.
		if t.OwnerUsername == "" || t.IsPublic {
			if t.Duration > 0 {
				ambients = append(ambients, t)
			}
		}
	}
	backgrounds := GetBackgrounds()
	if len(ambients) == 0 || len(backgrounds) == 0 {
		return nil
	}
	track := ambients[bm.rng.Intn(len(ambients))]
	bg := backgrounds[bm.rng.Intn(len(backgrounds))]

	duration := botMinDurationSec + bm.rng.Intn(botMaxDurationSec-botMinDurationSec+1)
	if track.Duration >= botTrackDurationThresholdSec {
		// Track durations are stored in seconds. If the audio is longer than
		// the threshold we treat it like a voice-length track and align the
		// meditation to its full length (the user-set "по времени трека" mode
		// the operator described).
		duration = clampDuration(track.Duration)
	}
	return &botSession{
		track:        track,
		duration:     duration,
		backgroundID: bg.ID,
	}
}

func clampDuration(trackSec int) int {
	if trackSec < botMinDurationSec {
		return botMinDurationSec
	}
	if trackSec > 4*60*60 {
		return 4 * 60 * 60
	}
	return trackSec
}

// botSession bundles the inputs a bot feeds to a single meditation room.
type botSession struct {
	track        Track
	duration     int
	backgroundID string
}

// requestAccessTicket posts to /api/rooms/access to obtain the access ticket
// the websocket handler requires.
func (bm *BotManager) requestAccessTicket(baseURL, token, roomID, clientID string) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"roomId":   roomID,
		"password": "",
		"clientId": clientID,
		"creating": true,
	})
	req, err := http.NewRequest("POST", strings.TrimRight(baseURL, "/")+"/api/rooms/access", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	httpClient := &http.Client{Timeout: botAccessEndpointTimeout}
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	rawBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("status %d: %s", resp.StatusCode, strings.TrimSpace(string(rawBody)))
	}
	var payload struct {
		Ticket string `json:"ticket"`
	}
	if err := json.Unmarshal(rawBody, &payload); err != nil {
		return "", err
	}
	if payload.Ticket == "" {
		return "", errors.New("empty access ticket")
	}
	return payload.Ticket, nil
}

// dialWebsocket performs the bot's websocket handshake. host should be a
// "host:port" pair (e.g. "127.0.0.1:8080"); scheme dictates ws/wss. The
// caller is responsible for reading from conn — gorilla/websocket connections
// are not safe for concurrent readers, so we deliberately do not spawn a
// drainer here. runHostBot runs its own watcher; runSpectatorBot runs its
// own closer.
func (bm *BotManager) dialWebsocket(scheme, host, roomID, token, clientID, roomName string, durationSec int, trackID, backgroundID, accessTicket string) (*websocket.Conn, error) {
	u := url.URL{
		Scheme:   scheme,
		Host:     host,
		Path:     "/ws",
		RawQuery: url.Values{
			"roomId":       {roomID},
			"token":        {token},
			"clientId":     {clientID},
			"roomName":     {roomName},
			"duration":     {fmt.Sprintf("%d", durationSec)},
			"trackId":      {trackID},
			"backgroundId": {backgroundID},
			"accessTicket": {accessTicket},
		}.Encode(),
	}
	dialer := *websocket.DefaultDialer
	dialer.HandshakeTimeout = 10 * time.Second
	header := http.Header{}
	conn, _, err := dialer.Dial(u.String(), header)
	if err != nil {
		return nil, err
	}
	return conn, nil
}

// resolveSelfURL picks the network address and scheme the bot manager uses
// to call itself. Order of preference:
//
//  1. BOT_SELF_URL e.g. "http://127.0.0.1:8080" or "https://zenworld.ru"
//  2. PUBLIC_URL/BACKEND_URL (operator-friendly env aliases)
//  3. localhost + PORT (good enough for local/dev)
func (bm *BotManager) resolveSelfURL() (baseURL, wsScheme, wsHost string, err error) {
	candidate := strings.TrimSpace(os.Getenv("BOT_SELF_URL"))
	if candidate == "" {
		candidate = strings.TrimSpace(os.Getenv("PUBLIC_URL"))
	}
	if candidate == "" {
		candidate = strings.TrimSpace(os.Getenv("BACKEND_URL"))
	}
	if candidate == "" {
		port := os.Getenv("PORT")
		if port == "" {
			port = "8080"
		}
		candidate = "http://127.0.0.1:" + port
	}
	u, parseErr := url.Parse(candidate)
	if parseErr != nil || u.Host == "" {
		return "", "", "", errors.New("could not determine bot self URL; set BOT_SELF_URL")
	}
	scheme := strings.ToLower(u.Scheme)
	switch scheme {
	case "https":
		wsScheme = "wss"
	case "http":
		wsScheme = "ws"
	default:
		return "", "", "", fmt.Errorf("unsupported scheme %q in BOT_SELF_URL", scheme)
	}
	return candidate, wsScheme, u.Host, nil
}

// --- helpers ---

func randomBotRoomID(rng *rand.Rand) string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	buf := make([]byte, 12)
	for i := range buf {
		buf[i] = alphabet[rng.Intn(len(alphabet))]
	}
	return botRoomIDPrefix + string(buf)
}

func randomBotClientID(rng *rand.Rand) string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	buf := make([]byte, 14)
	for i := range buf {
		buf[i] = alphabet[rng.Intn(len(alphabet))]
	}
	return "bot-c-" + string(buf)
}

func pickRandomString(rng *rand.Rand, choices []string) string {
	if len(choices) == 0 {
		return ""
	}
	return choices[rng.Intn(len(choices))]
}

// pickUniqueBot picks a random bot name that is not in used. Returns "" when
// every candidate is taken.
func pickUniqueBot(names []string, used map[string]bool) string {
	// Build candidate list once; randomized order feels more natural than
	// "first match" when several bots are available.
	available := make([]string, 0, len(names))
	for _, n := range names {
		if !used[n] {
			available = append(available, n)
		}
	}
	if len(available) == 0 {
		return ""
	}
	return available[rand.Intn(len(available))]
}

func mustEncode(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		// JSON marshalling of well-typed literal maps should never fail in
		// practice. Returning a noop message keeps the bot loop alive.
		return []byte(`{}`)
	}
	return b
}
