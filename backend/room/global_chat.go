package room

import (
	"errors"
	"strings"
	"time"
)

const (
	GlobalChatHistoryLimit = 5000
	GlobalChatMessageLimit = 500
)

// GlobalChatMessage is a persistent message shared by all users.
type GlobalChatMessage struct {
	ID        int64  `json:"id"`
	Username  string `json:"username"`
	Text      string `json:"text"`
	Timestamp int64  `json:"timestamp"`
}

// GetGlobalChatMessages returns either the latest messages or messages after a cursor.
func GetGlobalChatMessages(afterID int64, limit int) ([]GlobalChatMessage, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	query := `
		SELECT id, username, text, timestamp
		FROM (
			SELECT id, username, text, timestamp
			FROM global_chat_messages
			ORDER BY id DESC
			LIMIT ?
		)
		ORDER BY id ASC`
	args := []any{limit}

	if afterID > 0 {
		query = `
			SELECT id, username, text, timestamp
			FROM global_chat_messages
			WHERE id > ?
			ORDER BY id ASC
			LIMIT ?`
		args = []any{afterID, limit}
	}

	rows, err := dbConn.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	messages := make([]GlobalChatMessage, 0, limit)
	for rows.Next() {
		var message GlobalChatMessage
		if err := rows.Scan(&message.ID, &message.Username, &message.Text, &message.Timestamp); err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	return messages, rows.Err()
}

// AppendGlobalChatMessage stores a message and prunes history beyond the retention limit.
func AppendGlobalChatMessage(username, text string) (GlobalChatMessage, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return GlobalChatMessage{}, errors.New("message cannot be empty")
	}
	if len([]rune(text)) > GlobalChatMessageLimit {
		return GlobalChatMessage{}, errors.New("message is too long")
	}

	message := GlobalChatMessage{
		Username:  username,
		Text:      text,
		Timestamp: time.Now().UnixMilli(),
	}

	result, err := dbConn.Exec(
		"INSERT INTO global_chat_messages (username, text, timestamp) VALUES (?, ?, ?)",
		message.Username,
		message.Text,
		message.Timestamp,
	)
	if err != nil {
		return GlobalChatMessage{}, err
	}

	message.ID, err = result.LastInsertId()
	if err != nil {
		return GlobalChatMessage{}, err
	}

	_, _ = dbConn.Exec(`
		DELETE FROM global_chat_messages
		WHERE id <= (
			SELECT id
			FROM global_chat_messages
			ORDER BY id DESC
			LIMIT 1 OFFSET ?
		)`, GlobalChatHistoryLimit)

	return message, nil
}
