package room

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

func TestChatHistory(t *testing.T) {
	// Initialize in-memory SQLite DB for testing
	db := InitDB(":memory:")
	defer db.Close()

	// Initially history should be empty
	history := GetChatHistory("room1")
	if len(history) != 0 {
		t.Fatalf("expected empty history, got %d messages", len(history))
	}

	msg1 := ChatMessage{
		Username:  "alice",
		Text:      "hello world",
		Timestamp: 123456789,
	}

	AppendChatMessage("room1", msg1)

	// Verify msg was saved
	history = GetChatHistory("room1")
	if len(history) != 1 {
		t.Fatalf("expected 1 message, got %d", len(history))
	}
	if history[0].Username != "alice" || history[0].Text != "hello world" {
		t.Errorf("unexpected message content: %+v", history[0])
	}
}

func TestHubChatHistoryRegistration(t *testing.T) {
	db := InitDB(":memory:")
	defer db.Close()

	// Seed some history
	AppendChatMessage("test-room", ChatMessage{
		Username:  "alice",
		Text:      "old message",
		Timestamp: 100,
	})

	hub := NewHub()
	go hub.Run()

	client := &Client{
		Hub:             hub,
		Conn:            nil,
		Send:            make(chan []byte, 256),
		RoomID:          "test-room",
		RoomName:        "Test Room",
		ID:              "client-1",
		Username:        "bob",
		InitialDuration: 60,
	}

	hub.Register <- client

	// We should receive 2 messages in client.Send:
	// 1. "room_state" (from BroadcastRoomState)
	// 2. "chat_history" (from SendChatHistory)
	
	// Wait and read messages
	var roomStateReceived bool
	var chatHistoryReceived bool

	for i := 0; i < 2; i++ {
		select {
		case msgBytes := <-client.Send:
			var msg Message
			if err := json.Unmarshal(msgBytes, &msg); err != nil {
				t.Fatalf("failed to unmarshal message: %v", err)
			}
			if msg.Type == "room_state" {
				roomStateReceived = true
			} else if msg.Type == "chat_history" {
				chatHistoryReceived = true
				var history []ChatMessage
				if err := json.Unmarshal(msg.Payload, &history); err != nil {
					t.Fatalf("failed to unmarshal history: %v", err)
				}
				if len(history) != 1 || history[0].Username != "alice" || history[0].Text != "old message" {
					t.Errorf("unexpected history content: %+v", history)
				}
			}
		case <-time.After(1 * time.Second):
			t.Fatal("timeout waiting for messages")
		}
	}

	if !roomStateReceived {
		t.Error("room_state not received")
	}
	if !chatHistoryReceived {
		t.Error("chat_history not received")
	}
}

func TestMigrateJSONToDB(t *testing.T) {
	// Create temporary JSON files
	usersData := `{"admin":{"username":"admin","password_hash":"hash","salt":"salt"}}`
	tracksData := `[{"id":"track1","title":"Track 1","artist":"Artist 1","audioUrl":"/url","duration":100}]`
	chatsData := `{"room1":[{"username":"alice","text":"hello","timestamp":200}]}`

	_ = os.WriteFile("users.json", []byte(usersData), 0644)
	_ = os.WriteFile("tracks.json", []byte(tracksData), 0644)
	_ = os.WriteFile("chat_history.json", []byte(chatsData), 0644)

	defer func() {
		os.Remove("users.json")
		os.Remove("users.json.bak")
		os.Remove("tracks.json")
		os.Remove("tracks.json.bak")
		os.Remove("chat_history.json")
		os.Remove("chat_history.json.bak")
	}()

	db := InitDB(":memory:")
	defer db.Close()

	MigrateJSONToDB(db)

	// Verify users migrated
	var count int
	_ = db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if count != 1 {
		t.Errorf("expected 1 user, got %d", count)
	}

	// Verify tracks migrated
	_ = db.QueryRow("SELECT COUNT(*) FROM tracks").Scan(&count)
	if count != 1 {
		t.Errorf("expected 1 track, got %d", count)
	}

	// Verify chats migrated
	_ = db.QueryRow("SELECT COUNT(*) FROM chats").Scan(&count)
	if count != 1 {
		t.Errorf("expected 1 chat, got %d", count)
	}

	// Verify files were renamed
	if _, err := os.Stat("users.json.bak"); os.IsNotExist(err) {
		t.Errorf("users.json.bak was not created")
	}
	if _, err := os.Stat("tracks.json.bak"); os.IsNotExist(err) {
		t.Errorf("tracks.json.bak was not created")
	}
	if _, err := os.Stat("chat_history.json.bak"); os.IsNotExist(err) {
		t.Errorf("chat_history.json.bak was not created")
	}
}
