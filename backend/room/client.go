package room

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

const (
	// Time allowed to write a message to the peer.
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer.
	pongWait = 60 * time.Second

	// Send pings to peer with this period. Must be less than pongWait.
	pingPeriod = (pongWait * 9) / 10

	// Maximum message size allowed from peer.
	maxMessageSize = 1024 * 1024 // 1MB to support voice chunks
)

var (
	newline = []byte{'\n'}
	space   = []byte{' '}
)

// readPump pumps messages from the websocket connection to the hub.
func (c *Client) readPump() {
	defer func() {
		c.Hub.Unregister <- c
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(maxMessageSize)
	c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		messageType, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("error: %v", err)
			}
			break
		}

		if messageType == websocket.BinaryMessage {
			c.handleVoiceData(message)
		} else {
			message = bytes.TrimSpace(bytes.Replace(message, newline, space, -1))
			c.handleIncomingMessage(message)
		}
	}
}

// writePump pumps messages from the hub to the websocket connection.
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// The hub closed the channel.
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Add queued chat messages to the current websocket message.
			n := len(c.Send)
			for i := 0; i < n; i++ {
				w.Write(newline)
				w.Write(<-c.Send)
			}

			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// handleVoiceData processes incoming voice data from the host
func (c *Client) handleVoiceData(data []byte) {
	c.Hub.Mutex.RLock()
	room, exists := c.Hub.Rooms[c.RoomID]
	c.Hub.Mutex.RUnlock()

	if !exists {
		return
	}

	room.Mutex.Lock()
	defer room.Mutex.Unlock()

	// Only the host can stream voice
	if room.HostID != c.ID {
		return
	}

	// Write to recording file if open
	if room.VoiceFile != nil {
		_, err := room.VoiceFile.Write(data)
		if err != nil {
			log.Printf("Error writing voice chunk to file: %v", err)
		}
	}

	// Encode to base64 for broadcasting over text WebSocket
	base64Data := base64.StdEncoding.EncodeToString(data)
	type VoiceDataPayload struct {
		Data string `json:"data"`
	}
	payloadBytes, _ := json.Marshal(VoiceDataPayload{Data: base64Data})

	msg := Message{
		Type:    "voice_data",
		Payload: payloadBytes,
	}
	msgBytes, err := json.Marshal(msg)
	if err != nil {
		log.Println("Error marshalling voice data message:", err)
		return
	}

	// Broadcast voice chunk to other clients in room
	for client := range room.Clients {
		if client.ID != c.ID {
			select {
			case client.Send <- msgBytes:
			default:
			}
		}
	}
}

// handleIncomingMessage handles different websocket request types from clients
func (c *Client) handleIncomingMessage(rawMsg []byte) {
	var msg Message
	if err := json.Unmarshal(rawMsg, &msg); err != nil {
		log.Println("Error parsing websocket message:", err)
		return
	}

	c.Hub.Mutex.RLock()
	room, exists := c.Hub.Rooms[c.RoomID]
	c.Hub.Mutex.RUnlock()

	if !exists {
		return
	}

	switch msg.Type {
	case "chat":
		type ChatPayload struct {
			Text string `json:"text"`
		}
		var payload ChatPayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			log.Println("Error parsing chat payload:", err)
			return
		}
		if payload.Text != "" {
			c.Hub.BroadcastChatMessage(c.RoomID, c.Username, payload.Text)
		}

	case "start":
		room.Mutex.Lock()
		// Only the host can start meditation
		if room.HostID != c.ID {
			room.Mutex.Unlock()
			log.Println("Non-host tried to start meditation")
			return
		}

		type StartPayload struct {
			TrackID      string `json:"trackId"`
			Duration     int    `json:"duration"` // duration in seconds
			VoiceTrackID string `json:"voiceTrackId"`
		}
		var payload StartPayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			room.Mutex.Unlock()
			log.Println("Error parsing start payload:", err)
			return
		}

		// Find track details
		track := FindTrack(payload.TrackID)
		if track == nil {
			room.Mutex.Unlock()
			log.Printf("Track %s not found", payload.TrackID)
			return
		}

		room.Status = "playing"
		room.ActiveTrack = track
		room.Duration = payload.Duration
		room.StartedAt = time.Now().UnixNano() / int64(time.Millisecond)

		// Check if a pre-recorded voice track was selected
		var voiceTrack *Track
		if payload.VoiceTrackID != "" {
			voiceTrack = FindTrack(payload.VoiceTrackID)
			if voiceTrack != nil {
				room.VoiceFilePath = voiceTrack.AudioURL
				room.VoiceStartedAt = room.StartedAt
			}
		} else {
			room.VoiceFilePath = ""
			room.VoiceStartedAt = 0
		}
		room.Mutex.Unlock()

		log.Printf("Meditation started in room %s. Track: %s, Duration: %ds", room.ID, track.Title, payload.Duration)
		c.Hub.BroadcastRoomState(c.RoomID)

		// If pre-recorded voice is selected, broadcast voice_start instantly!
		if voiceTrack != nil {
			c.Hub.BroadcastVoiceEvent(c.RoomID, "voice_start", c.Username)
		}

		// Start a timer to end the meditation when it completes
		go func(r *Room, duration int, startMs int64) {
			time.Sleep(time.Duration(duration) * time.Second)
			r.Mutex.Lock()
			// Check if this specific meditation is still active
			if r.Status == "playing" && r.StartedAt == startMs {
				hasVoice := r.VoiceFilePath != ""
				r.Status = "finished"
				r.VoiceFilePath = ""
				r.VoiceStartedAt = 0
				r.Mutex.Unlock()
				c.Hub.BroadcastRoomState(r.ID)
				log.Printf("Meditation naturally completed in room %s", r.ID)
				if hasVoice {
					c.Hub.BroadcastVoiceEvent(r.ID, "voice_stop", "")
				}
			} else {
				r.Mutex.Unlock()
			}
		}(room, payload.Duration, room.StartedAt)

	case "stop":
		room.Mutex.Lock()
		if room.HostID != c.ID {
			room.Mutex.Unlock()
			return
		}
		hasVoice := room.VoiceFilePath != ""
		room.Status = "lobby"
		room.ActiveTrack = nil
		room.StartedAt = 0
		room.VoiceFilePath = ""
		room.VoiceStartedAt = 0
		room.Mutex.Unlock()

		log.Printf("Meditation stopped in room %s", room.ID)
		c.Hub.BroadcastRoomState(c.RoomID)

		if hasVoice {
			c.Hub.BroadcastVoiceEvent(c.RoomID, "voice_stop", "")
		}

	case "voice_start":
		room.Mutex.Lock()
		if room.HostID != c.ID {
			room.Mutex.Unlock()
			log.Println("Non-host tried to start voice streaming")
			return
		}

		// Ensure directory exists
		os.MkdirAll("./uploads/recordings", 0755)

		// Create unique filename
		timestamp := time.Now().Unix()
		filename := fmt.Sprintf("rec_%s_%d.webm", room.ID, timestamp)
		filePath := fmt.Sprintf("./uploads/recordings/%s", filename)

		file, err := os.Create(filePath)
		if err != nil {
			log.Printf("Error creating voice recording file: %v", err)
		}

		room.VoiceFile = file
		room.VoiceFilePath = fmt.Sprintf("/uploads/recordings/%s", filename)
		room.VoiceStartedAt = time.Now().UnixNano() / int64(time.Millisecond)
		room.Mutex.Unlock()

		log.Printf("Voice streaming started in room %s. Recording to %s", room.ID, filePath)

		// Broadcast voice_start to all clients in the room
		c.Hub.BroadcastVoiceEvent(c.RoomID, "voice_start", c.Username)

	case "voice_stop":
		room.Mutex.Lock()
		if room.HostID != c.ID {
			room.Mutex.Unlock()
			return
		}
		c.Hub.stopVoiceRecordingLocked(room)
		room.Mutex.Unlock()
	}
}

// InitTracks инициализирует список дефолтных треков в БД, если таблица пуста
func InitTracks() {
	var count int
	err := dbConn.QueryRow("SELECT COUNT(*) FROM tracks").Scan(&count)
	if err != nil {
		log.Printf("Error counting tracks in DB: %v", err)
		return
	}

	if count > 0 {
		log.Printf("Loaded tracks from SQLite database")
		return
	}

	// Дефолтные треки, если база пуста
	defaultTracks := []Track{
		{
			ID:       "ambient-rain",
			Title:    "Gentle Rain & Thunder",
			Artist:   "Nature Sounds",
			AudioURL: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
			Duration: 372,
		},
		{
			ID:       "tibetan-bowls",
			Title:    "Tibetan Singing Bowls Meditation",
			Artist:   "Spirituality",
			AudioURL: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
			Duration: 423,
		},
		{
			ID:       "deep-relaxation",
			Title:    "Deep Sleep & Astral Relaxation",
			Artist:   "Solitude Music",
			AudioURL: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
			Duration: 302,
		},
	}

	tx, err := dbConn.Begin()
	if err != nil {
		log.Printf("Error starting transaction: %v", err)
		return
	}

	for _, t := range defaultTracks {
		_, err := tx.Exec("INSERT INTO tracks (id, title, artist, audio_url, duration) VALUES (?, ?, ?, ?, ?)",
			t.ID, t.Title, t.Artist, t.AudioURL, t.Duration)
		if err != nil {
			log.Printf("Error inserting default track %s: %v", t.Title, err)
		}
	}

	_ = tx.Commit()
	log.Println("Initialized default tracks in SQLite database")
}

func FindTrack(id string) *Track {
	var t Track
	err := dbConn.QueryRow("SELECT id, title, artist, audio_url, duration, IFNULL(owner_username, '') FROM tracks WHERE id = ?", id).
		Scan(&t.ID, &t.Title, &t.Artist, &t.AudioURL, &t.Duration, &t.OwnerUsername)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil
		}
		log.Printf("Error finding track %s: %v", id, err)
		return nil
	}
	return &t
}

func GetTracks() []Track {
	rows, err := dbConn.Query("SELECT id, title, artist, audio_url, duration, IFNULL(owner_username, '') FROM tracks")
	if err != nil {
		log.Printf("Error getting tracks: %v", err)
		return []Track{}
	}
	defer rows.Close()

	var tracks []Track
	for rows.Next() {
		var t Track
		if err := rows.Scan(&t.ID, &t.Title, &t.Artist, &t.AudioURL, &t.Duration, &t.OwnerUsername); err == nil {
			tracks = append(tracks, t)
		}
	}
	return tracks
}

func GetTracksForUser(username string) []Track {
	rows, err := dbConn.Query("SELECT id, title, artist, audio_url, duration, IFNULL(owner_username, '') FROM tracks WHERE owner_username IS NULL OR owner_username = '' OR owner_username = ?", username)
	if err != nil {
		log.Printf("Error getting tracks for user %s: %v", username, err)
		return []Track{}
	}
	defer rows.Close()

	var tracks []Track
	for rows.Next() {
		var t Track
		if err := rows.Scan(&t.ID, &t.Title, &t.Artist, &t.AudioURL, &t.Duration, &t.OwnerUsername); err == nil {
			tracks = append(tracks, t)
		}
	}
	return tracks
}

// AddTrack добавляет новый трек в БД
func AddTrack(title, artist, audioURL string, duration int, ownerUsername string) (Track, error) {
	title = strings.TrimSpace(title)
	artist = strings.TrimSpace(artist)
	audioURL = strings.TrimSpace(audioURL)

	if title == "" || artist == "" || audioURL == "" || duration <= 0 {
		return Track{}, errors.New("invalid track metadata")
	}

	// Генерация ID на основе названия
	id := strings.ToLower(title)
	id = strings.ReplaceAll(id, " ", "-")
	var cleanID []rune
	for _, r := range id {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			cleanID = append(cleanID, r)
		}
	}
	id = string(cleanID)
	if id == "" {
		id = "track-" + time.Now().Format("20060102150405")
	}

	// Убедимся, что ID уникальный в БД
	baseID := id
	counter := 1
	for {
		var exists bool
		err := dbConn.QueryRow("SELECT EXISTS(SELECT 1 FROM tracks WHERE id = ?)", id).Scan(&exists)
		if err != nil {
			return Track{}, err
		}
		if !exists {
			break
		}
		id = fmt.Sprintf("%s-%d", baseID, counter)
		counter++
	}

	newTrack := Track{
		ID:            id,
		Title:         title,
		Artist:        artist,
		AudioURL:      audioURL,
		Duration:      duration,
		OwnerUsername: ownerUsername,
	}

	_, err := dbConn.Exec("INSERT INTO tracks (id, title, artist, audio_url, duration, owner_username) VALUES (?, ?, ?, ?, ?, ?)",
		newTrack.ID, newTrack.Title, newTrack.Artist, newTrack.AudioURL, newTrack.Duration, newTrack.OwnerUsername)
	if err != nil {
		return Track{}, err
	}

	return newTrack, nil
}

// DeleteTrack удаляет трек по ID из БД
func DeleteTrack(id string) error {
	res, err := dbConn.Exec("DELETE FROM tracks WHERE id = ?", id)
	if err != nil {
		return err
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return errors.New("track not found")
	}
	return nil
}
