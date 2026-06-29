package room

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
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
	maxMessageSize = 512
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
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("error: %v", err)
			}
			break
		}

		message = bytes.TrimSpace(bytes.Replace(message, newline, space, -1))
		c.handleIncomingMessage(message)
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
			TrackID  string `json:"trackId"`
			Duration int    `json:"duration"` // duration in seconds
		}
		var payload StartPayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			room.Mutex.Unlock()
			log.Println("Error parsing start payload:", err)
			return
		}

		// Find track details
		// We will hardcode some tracks in the server or in the room package.
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
		room.Mutex.Unlock()

		log.Printf("Meditation started in room %s. Track: %s, Duration: %ds", room.ID, track.Title, payload.Duration)
		c.Hub.BroadcastRoomState(c.RoomID)

		// Start a timer to end the meditation when it completes
		go func(r *Room, duration int, startMs int64) {
			time.Sleep(time.Duration(duration) * time.Second)
			r.Mutex.Lock()
			// Check if this specific meditation is still active
			if r.Status == "playing" && r.StartedAt == startMs {
				r.Status = "finished"
				r.Mutex.Unlock()
				c.Hub.BroadcastRoomState(r.ID)
				log.Printf("Meditation naturally completed in room %s", r.ID)
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
		room.Status = "lobby"
		room.ActiveTrack = nil
		room.StartedAt = 0
		room.Mutex.Unlock()

		log.Printf("Meditation stopped in room %s", room.ID)
		c.Hub.BroadcastRoomState(c.RoomID)
	}
}

var (
	tracksMutex sync.RWMutex
	tracksList  []Track
	tracksFile  = "tracks.json"
)

// InitTracks инициализирует список треков из файла tracks.json
func InitTracks() {
	tracksMutex.Lock()
	defer tracksMutex.Unlock()

	// Попытка загрузить из файла
	data, err := os.ReadFile(tracksFile)
	if err == nil {
		if err := json.Unmarshal(data, &tracksList); err == nil && len(tracksList) > 0 {
			log.Printf("Loaded %d tracks from %s", len(tracksList), tracksFile)
			return
		}
	}

	// Дефолтные треки, если файла нет или он пуст
	tracksList = []Track{
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

	// Сохранение дефолтных треков
	saveTracksLocked()
	log.Printf("Initialized default tracks in %s", tracksFile)
}

func saveTracksLocked() {
	data, err := json.MarshalIndent(tracksList, "", "  ")
	if err != nil {
		log.Printf("Error encoding tracks: %v", err)
		return
	}
	if err := os.WriteFile(tracksFile, data, 0644); err != nil {
		log.Printf("Error writing tracks to file: %v", err)
	}
}

func FindTrack(id string) *Track {
	tracksMutex.RLock()
	defer tracksMutex.RUnlock()

	for _, t := range tracksList {
		if t.ID == id {
			// Возвращаем копию, чтобы избежать race conditions при изменении полей
			trackCopy := t
			return &trackCopy
		}
	}
	return nil
}

func GetTracks() []Track {
	tracksMutex.RLock()
	defer tracksMutex.RUnlock()

	// Возвращаем копию слайса
	res := make([]Track, len(tracksList))
	copy(res, tracksList)
	return res
}

// AddTrack добавляет новый трек
func AddTrack(title, artist, audioURL string, duration int) (Track, error) {
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

	tracksMutex.Lock()
	defer tracksMutex.Unlock()

	// Убедимся, что ID уникальный
	baseID := id
	counter := 1
	for {
		found := false
		for _, t := range tracksList {
			if t.ID == id {
				found = true
				break
			}
		}
		if !found {
			break
		}
		id = fmt.Sprintf("%s-%d", baseID, counter)
		counter++
	}

	newTrack := Track{
		ID:       id,
		Title:    title,
		Artist:   artist,
		AudioURL: audioURL,
		Duration: duration,
	}

	tracksList = append(tracksList, newTrack)
	saveTracksLocked()

	return newTrack, nil
}

// DeleteTrack удаляет трек по ID
func DeleteTrack(id string) error {
	tracksMutex.Lock()
	defer tracksMutex.Unlock()

	index := -1
	for i, t := range tracksList {
		if t.ID == id {
			index = i
			break
		}
	}

	if index == -1 {
		return errors.New("track not found")
	}

	// Удаление элемента из слайса
	tracksList = append(tracksList[:index], tracksList[index+1:]...)
	saveTracksLocked()

	return nil
}
