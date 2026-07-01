package room

import (
	"path/filepath"
	"testing"
)

func setupSocialTestDB(t *testing.T) {
	t.Helper()
	db := InitDB(filepath.Join(t.TempDir(), "social.db"))
	t.Cleanup(func() { _ = db.Close() })
	for _, username := range []string{"Alice", "Bob"} {
		if _, err := db.Exec(
			"INSERT INTO users (username, password_hash, salt) VALUES (?, 'hash', 'salt')",
			username,
		); err != nil {
			t.Fatal(err)
		}
	}
}

func TestProfileStatisticsAndLikes(t *testing.T) {
	setupSocialTestDB(t)
	if err := RecordRoomParticipation("room-one", "Alice", true); err != nil {
		t.Fatal(err)
	}
	if err := RecordRoomParticipation("room-two", "Alice", false); err != nil {
		t.Fatal(err)
	}
	if err := RecordRoomParticipation("room-two", "Alice", false); err != nil {
		t.Fatal(err)
	}
	if err := SetProfileLike("Alice", "Bob", true); err != nil {
		t.Fatal(err)
	}

	profile, err := GetUserProfile("Bob", "alice")
	if err != nil {
		t.Fatal(err)
	}
	if profile.HostedCount != 1 || profile.ParticipatedCount != 1 ||
		profile.LikesCount != 1 || !profile.LikedByMe {
		t.Fatalf("unexpected profile: %+v", profile)
	}

	if err := SetProfileLike("Alice", "Bob", false); err != nil {
		t.Fatal(err)
	}
	profile, err = GetUserProfile("Bob", "Alice")
	if err != nil {
		t.Fatal(err)
	}
	if profile.LikesCount != 0 || profile.LikedByMe {
		t.Fatalf("like was not removed: %+v", profile)
	}
}

func TestDirectMessagesAndUnreadNotifications(t *testing.T) {
	setupSocialTestDB(t)
	sent, err := AddDirectMessage("Alice", "Bob", " Привет! ")
	if err != nil {
		t.Fatal(err)
	}
	if sent.Text != "Привет!" {
		t.Fatalf("message was not trimmed: %q", sent.Text)
	}
	count, err := UnreadDirectMessageCount("Bob")
	if err != nil || count != 1 {
		t.Fatalf("unexpected unread count %d: %v", count, err)
	}

	conversations, err := ListConversations("Bob")
	if err != nil {
		t.Fatal(err)
	}
	if len(conversations) != 1 || conversations[0].Username != "Alice" ||
		conversations[0].UnreadCount != 1 {
		t.Fatalf("unexpected conversations: %+v", conversations)
	}

	messages, err := ListDirectMessages("Bob", "Alice")
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 || messages[0].Text != "Привет!" || messages[0].ReadAt == nil {
		t.Fatalf("unexpected messages: %+v", messages)
	}
	count, err = UnreadDirectMessageCount("Bob")
	if err != nil || count != 0 {
		t.Fatalf("message was not marked read, count %d: %v", count, err)
	}
}
