package room

import (
	"fmt"
	"testing"
)

func TestGlobalChatMessagesAndCursor(t *testing.T) {
	db := InitDB(":memory:")
	defer db.Close()

	first, err := AppendGlobalChatMessage("alice", "first")
	if err != nil {
		t.Fatalf("append first message: %v", err)
	}
	second, err := AppendGlobalChatMessage("bob", "second")
	if err != nil {
		t.Fatalf("append second message: %v", err)
	}

	history, err := GetGlobalChatMessages(0, 50)
	if err != nil {
		t.Fatalf("get history: %v", err)
	}
	if len(history) != 2 || history[0].ID != first.ID || history[1].ID != second.ID {
		t.Fatalf("unexpected history: %+v", history)
	}

	incremental, err := GetGlobalChatMessages(first.ID, 50)
	if err != nil {
		t.Fatalf("get incremental messages: %v", err)
	}
	if len(incremental) != 1 || incremental[0].ID != second.ID {
		t.Fatalf("unexpected incremental messages: %+v", incremental)
	}
}

func TestGlobalChatRetention(t *testing.T) {
	db := InitDB(":memory:")
	defer db.Close()

	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("begin seed transaction: %v", err)
	}
	for index := 0; index < GlobalChatHistoryLimit; index++ {
		if _, err := tx.Exec(
			"INSERT INTO global_chat_messages (username, text, timestamp) VALUES (?, ?, ?)",
			"seed",
			fmt.Sprintf("message-%d", index),
			index,
		); err != nil {
			_ = tx.Rollback()
			t.Fatalf("seed message %d: %v", index, err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit seed messages: %v", err)
	}

	if _, err := AppendGlobalChatMessage("alice", "newest"); err != nil {
		t.Fatalf("append newest message: %v", err)
	}

	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM global_chat_messages").Scan(&count); err != nil {
		t.Fatalf("count messages: %v", err)
	}
	if count != GlobalChatHistoryLimit {
		t.Fatalf("expected %d retained messages, got %d", GlobalChatHistoryLimit, count)
	}
}
