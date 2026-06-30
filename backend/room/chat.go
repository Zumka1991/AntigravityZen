package room

import (
	"log"
)

// ChatMessage represents a single chat message stored in room history
type ChatMessage struct {
	Username  string `json:"username"`
	Text      string `json:"text"`
	Timestamp int64  `json:"timestamp"`
}

// InitChat verifies that the chat history is ready
func InitChat() {
	log.Println("Chat history system initialized with SQLite")
}

// GetChatHistory returns last 100 chat messages for a specific room sorted chronologically
func GetChatHistory(roomID string) []ChatMessage {
	rows, err := dbConn.Query(`
		SELECT username, text, timestamp 
		FROM (
			SELECT id, username, text, timestamp 
			FROM chats 
			WHERE room_id = ? 
			ORDER BY id DESC 
			LIMIT 100
		) 
		ORDER BY id ASC`, roomID)
	if err != nil {
		log.Printf("Error getting chat history for room %s: %v", roomID, err)
		return []ChatMessage{}
	}
	defer rows.Close()

	var history []ChatMessage
	for rows.Next() {
		var msg ChatMessage
		if err := rows.Scan(&msg.Username, &msg.Text, &msg.Timestamp); err == nil {
			history = append(history, msg)
		}
	}
	return history
}

// AppendChatMessage adds a message to the history of a room in SQLite
func AppendChatMessage(roomID string, msg ChatMessage) {
	_, err := dbConn.Exec("INSERT INTO chats (room_id, username, text, timestamp) VALUES (?, ?, ?, ?)",
		roomID, msg.Username, msg.Text, msg.Timestamp)
	if err != nil {
		log.Printf("Error inserting chat message for room %s: %v", roomID, err)
	}
}
