package room

import (
	"bytes"
	"encoding/json"
	"log"
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

// Mock database of tracks for meditation
var mockTracks = []Track{
	{
		ID:       "ambient-rain",
		Title:    "Gentle Rain & Thunder",
		Artist:   "Nature Sounds",
		AudioURL: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", // Using public MP3 examples for test
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

func FindTrack(id string) *Track {
	for _, t := range mockTracks {
		if t.ID == id {
			return &t
		}
	}
	return nil
}

func GetTracks() []Track {
	return mockTracks
}
