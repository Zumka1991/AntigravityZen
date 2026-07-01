package room

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for simplicity
	},
}

// Track represents a meditation music track
type Track struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	Artist        string `json:"artist"`
	AudioURL      string `json:"audioUrl"`
	Duration      int    `json:"duration"` // in seconds
	OwnerUsername string `json:"ownerUsername,omitempty"`
	IsPublic      bool   `json:"isPublic"`
}

// Message sent over websocket
type Message struct {
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
	Username  string          `json:"username,omitempty"`
	Timestamp int64           `json:"timestamp,omitempty"`
}

// RoomState payload sent to clients
type RoomState struct {
	ID          string                `json:"id"`
	Name        string                `json:"name"`
	HostID      string                `json:"hostId"`
	Clients     []User                `json:"clients"`
	Status      string                `json:"status"` // "lobby", "playing", "finished"
	ActiveTrack *Track                `json:"activeTrack,omitempty"`
	VoiceTrack  *Track                `json:"voiceTrack,omitempty"`
	Background  *MeditationBackground `json:"background,omitempty"`
	Duration    int                   `json:"duration,omitempty"`  // selected duration in seconds
	StartedAt   int64                 `json:"startedAt,omitempty"` // Unix timestamp in ms
	ServerTime  int64                 `json:"serverTime"`          // current server Unix timestamp in ms
	HostPresent bool                  `json:"hostPresent"`
}

type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	IsHost   bool   `json:"isHost"`
}

// Client represents a connected websocket client
type Client struct {
	Hub                 *Hub
	Conn                *websocket.Conn
	Send                chan []byte
	RoomID              string
	RoomName            string
	ID                  string
	Username            string
	InitialDuration     int
	InitialTrackID      string
	InitialVoiceTrackID string
	InitialBackgroundID string
}

// Room represents a single meditation session room
type Room struct {
	ID             string
	Name           string
	HostID         string
	HostUsername   string
	Clients        map[*Client]bool
	Status         string // "lobby", "playing", "finished"
	ActiveTrack    *Track
	VoiceTrack     *Track // pre-recorded voice accompaniment
	Background     *MeditationBackground
	Duration       int   // in seconds
	StartedAt      int64 // timestamp in ms
	VoiceFile      *os.File
	VoiceFilePath  string
	VoiceStartedAt int64 // Unix timestamp in ms
	PasswordHash   []byte
	EmptySince     int64
	Mutex          sync.RWMutex
}

// Hub maintains the state of active rooms and clients
type Hub struct {
	Rooms            map[string]*Room
	Register         chan *Client
	Unregister       chan *Client
	Leave            chan *Client
	PendingPasswords map[string][]byte
	AccessTickets    map[string]RoomAccessTicket
	Mutex            sync.RWMutex
}

func NewHub() *Hub {
	return &Hub{
		Rooms:            make(map[string]*Room),
		Register:         make(chan *Client),
		Unregister:       make(chan *Client),
		Leave:            make(chan *Client),
		PendingPasswords: make(map[string][]byte),
		AccessTickets:    make(map[string]RoomAccessTicket),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.Register:
			h.Mutex.Lock()
			room, exists := h.Rooms[client.RoomID]
			if !exists {
				name := client.RoomName
				if name == "" {
					name = client.Username + "'s Room"
				}
				track := FindTrack(client.InitialTrackID)
				if track == nil && len(GetTracks()) > 0 {
					track = &GetTracks()[0]
				}
				voiceTrack := FindTrack(client.InitialVoiceTrackID)
				background := FindBackground(client.InitialBackgroundID)
				if background == nil && len(GetBackgrounds()) > 0 {
					background = &GetBackgrounds()[0]
				}
				duration := client.InitialDuration
				if duration <= 0 {
					duration = 60 // 1 minute default
				}
				// First client in the room becomes the host
				room = &Room{
					ID:           client.RoomID,
					Name:         name,
					HostID:       client.ID,
					HostUsername: client.Username,
					Clients:      make(map[*Client]bool),
					Status:       "lobby",
					ActiveTrack:  track,
					VoiceTrack:   voiceTrack,
					Background:   background,
					Duration:     duration,
					PasswordHash: h.PendingPasswords[client.RoomID],
				}
				delete(h.PendingPasswords, client.RoomID)
				h.Rooms[client.RoomID] = room
				trackTitle := "none"
				if track != nil {
					trackTitle = track.Title
				}
				voiceTitle := "none"
				if voiceTrack != nil {
					voiceTitle = voiceTrack.Title
				}
				log.Printf("Created room %s with host %s, name %s, duration %ds, track %s, voice %s", client.RoomID, client.Username, name, duration, trackTitle, voiceTitle)
			}

			room.Mutex.Lock()
			room.Clients[client] = true
			room.EmptySince = 0
			// The same authenticated account may reclaim host control after
			// reopening a tab or reconnecting after a server restart.
			if (room.HostID == "" && room.HostUsername == "") ||
				(room.HostUsername != "" && strings.EqualFold(room.HostUsername, client.Username)) {
				room.HostID = client.ID
				room.HostUsername = client.Username
			}
			room.Mutex.Unlock()
			h.Mutex.Unlock()

			if err := PersistRoom(room); err != nil {
				log.Printf("Could not persist room %s: %v", room.ID, err)
			}
			if err := SaveRoomMember(room.ID, client.Username, client.ID); err != nil {
				log.Printf("Could not persist room membership for %s: %v", client.Username, err)
			}

			// Broadcast updated room state
			h.BroadcastRoomState(client.RoomID)
			h.SendChatHistory(client)

		case client := <-h.Unregister:
			var emptySince int64
			h.Mutex.Lock()
			room, exists := h.Rooms[client.RoomID]
			if exists {
				room.Mutex.Lock()
				if _, ok := room.Clients[client]; ok {
					delete(room.Clients, client)
					close(client.Send)
					log.Printf("Client %s disconnected from room %s", client.Username, client.RoomID)

					// Keep the room and host identity. The client will normally
					// reconnect within seconds after a deploy or network hiccup.
					if room.HostID == client.ID {
						h.stopVoiceRecordingLocked(room)
					}
					if len(room.Clients) == 0 {
						emptySince = time.Now().UnixMilli()
						room.EmptySince = emptySince
					}
				}
				room.Mutex.Unlock()
			}
			h.Mutex.Unlock()
			if exists {
				if err := PersistRoom(room); err != nil {
					log.Printf("Could not persist disconnected room %s: %v", room.ID, err)
				}
				h.BroadcastRoomState(client.RoomID)
				if emptySince != 0 {
					go h.scheduleEmptyRoomCleanup(client.RoomID, emptySince, emptyRoomGracePeriod)
				}
			}

		case client := <-h.Leave:
			h.removeClientPermanently(client)
		}
	}
}

func (h *Hub) BroadcastRoomState(roomID string) {
	h.Mutex.RLock()
	room, exists := h.Rooms[roomID]
	h.Mutex.RUnlock()

	if !exists {
		return
	}

	room.Mutex.Lock()
	defer room.Mutex.Unlock()

	users := make([]User, 0, len(room.Clients))
	for c := range room.Clients {
		users = append(users, User{
			ID:       c.ID,
			Username: c.Username,
			IsHost:   c.ID == room.HostID,
		})
	}

	state := RoomState{
		ID:          room.ID,
		Name:        room.Name,
		HostID:      room.HostID,
		Clients:     users,
		Status:      room.Status,
		ActiveTrack: room.ActiveTrack,
		VoiceTrack:  room.VoiceTrack,
		Background:  room.Background,
		Duration:    room.Duration,
		StartedAt:   room.StartedAt,
		ServerTime:  time.Now().UnixNano() / int64(time.Millisecond),
		HostPresent: false,
	}
	for c := range room.Clients {
		if strings.EqualFold(c.Username, room.HostUsername) {
			state.HostPresent = true
			break
		}
	}

	stateBytes, err := json.Marshal(state)
	if err != nil {
		log.Println("Error marshalling room state:", err)
		return
	}

	msg := Message{
		Type:    "room_state",
		Payload: stateBytes,
	}

	msgBytes, err := json.Marshal(msg)
	if err != nil {
		log.Println("Error marshalling message:", err)
		return
	}

	for c := range room.Clients {
		select {
		case c.Send <- msgBytes:
		default:
			close(c.Send)
			delete(room.Clients, c)
		}
	}
}

func (h *Hub) BroadcastChatMessage(roomID string, from string, text string) {
	h.Mutex.RLock()
	room, exists := h.Rooms[roomID]
	h.Mutex.RUnlock()

	if !exists {
		return
	}

	room.Mutex.RLock()
	defer room.Mutex.RUnlock()

	type ChatPayload struct {
		Text string `json:"text"`
	}

	payloadBytes, _ := json.Marshal(ChatPayload{Text: text})
	msg := Message{
		Type:      "chat",
		Payload:   payloadBytes,
		Username:  from,
		Timestamp: time.Now().UnixNano() / int64(time.Millisecond),
	}

	// Save to persistent history
	chatMsg := ChatMessage{
		Username:  from,
		Text:      text,
		Timestamp: msg.Timestamp,
	}
	AppendChatMessage(roomID, chatMsg)

	msgBytes, err := json.Marshal(msg)
	if err != nil {
		log.Println("Error marshalling chat message:", err)
		return
	}

	for c := range room.Clients {
		select {
		case c.Send <- msgBytes:
		default:
			// Client channel full, unregistering is handled in writePump
		}
	}
}

func (h *Hub) SendChatHistory(client *Client) {
	history := GetChatHistory(client.RoomID)
	if len(history) == 0 {
		return
	}

	historyBytes, err := json.Marshal(history)
	if err != nil {
		log.Println("Error marshalling chat history:", err)
		return
	}

	msg := Message{
		Type:    "chat_history",
		Payload: historyBytes,
	}

	msgBytes, err := json.Marshal(msg)
	if err != nil {
		log.Println("Error marshalling history message:", err)
		return
	}

	select {
	case client.Send <- msgBytes:
	default:
		// Send buffer full or client disconnected
	}
}

// ServeWs upgrades HTTP connection to websocket
func ServeWs(hub *Hub, w http.ResponseWriter, r *http.Request, roomID string, username string, clientID string, roomName string, initialDuration int, initialTrackID string, initialVoiceTrackID string, initialBackgroundID string) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}

	client := &Client{
		Hub:                 hub,
		Conn:                conn,
		Send:                make(chan []byte, 256),
		RoomID:              roomID,
		RoomName:            roomName,
		ID:                  clientID,
		Username:            username,
		InitialDuration:     initialDuration,
		InitialTrackID:      initialTrackID,
		InitialVoiceTrackID: initialVoiceTrackID,
		InitialBackgroundID: initialBackgroundID,
	}

	client.Hub.Register <- client

	// Start reading and writing routines
	go client.writePump()
	go client.readPump()
}

// BroadcastVoiceEvent sends voice events like voice_start/voice_stop to all clients in a room
func (h *Hub) BroadcastVoiceEvent(roomID string, eventType string, username string) {
	h.Mutex.RLock()
	room, exists := h.Rooms[roomID]
	h.Mutex.RUnlock()

	if !exists {
		return
	}

	room.Mutex.RLock()
	clients := make([]*Client, 0, len(room.Clients))
	for c := range room.Clients {
		clients = append(clients, c)
	}
	// Add file URL for voice_start events
	var payloadBytes []byte
	if eventType == "voice_start" && room.VoiceFilePath != "" {
		type VoiceStartPayload struct {
			FileUrl  string `json:"file_url"`
			IsStatic bool   `json:"is_static"`
		}
		isStatic := room.VoiceFile == nil
		payloadBytes, _ = json.Marshal(VoiceStartPayload{
			FileUrl:  room.VoiceFilePath,
			IsStatic: isStatic,
		})
	}
	room.Mutex.RUnlock()

	msg := Message{
		Type:     eventType,
		Username: username,
		Payload:  payloadBytes,
	}

	msgBytes, err := json.Marshal(msg)
	if err != nil {
		log.Println("Error marshalling voice event:", err)
		return
	}

	for _, c := range clients {
		select {
		case c.Send <- msgBytes:
		default:
		}
	}
}

// stopVoiceRecordingLocked stops recording, registers the track, and broadcasts voice_stop. Room mutex must be locked when calling.
func (h *Hub) stopVoiceRecordingLocked(room *Room) {
	if room.VoiceFile == nil {
		return
	}

	_ = room.VoiceFile.Close()
	room.VoiceFile = nil

	// Compute duration from VoiceStartedAt (always set when recording is active)
	var durationSec int
	if room.VoiceStartedAt > 0 {
		durationMs := (time.Now().UnixNano() / int64(time.Millisecond)) - room.VoiceStartedAt
		durationSec = int(durationMs / 1000)
	}

	log.Printf("Voice streaming stopped in room %s. Recorded duration: %ds", room.ID, durationSec)

	filePath := room.VoiceFilePath
	roomName := room.Name
	hostID := room.HostID

	// Register track in DB asynchronously to keep websocket thread responsive
	if durationSec > 0 {
		hostUsername := "Host"
		for c := range room.Clients {
			if c.ID == hostID {
				hostUsername = c.Username
				break
			}
		}
		go func() {
			title := fmt.Sprintf("Guided Session - %s", roomName)
			_, err := AddTrack(title, hostUsername, filePath, durationSec, hostUsername, false)
			if err != nil {
				log.Printf("Error registering recorded track: %v", err)
			} else {
				log.Printf("Recorded track registered successfully: %s", title)
			}
		}()
	} else if filePath != "" {
		go func() {
			_ = os.Remove("." + filePath)
			log.Printf("Removed short voice recording: .%s", filePath)
		}()
	}

	room.VoiceFilePath = ""
	room.VoiceStartedAt = 0

	// Broadcast voice_stop asynchronously
	roomID := room.ID
	go h.BroadcastVoiceEvent(roomID, "voice_stop", "")
}
