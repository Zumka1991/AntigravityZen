package room

import (
	"path/filepath"
	"testing"
	"time"
)

func TestSessionSurvivesAuthManagerRestart(t *testing.T) {
	db := InitDB(filepath.Join(t.TempDir(), "sessions.db"))
	defer db.Close()

	firstManager := NewAuthManager(db)
	token, err := firstManager.Register("persistent-user", "quiet123")
	if err != nil {
		t.Fatalf("register user: %v", err)
	}

	restartedManager := NewAuthManager(db)
	username, valid := restartedManager.ValidateToken(token)
	if !valid || username != "persistent-user" {
		t.Fatalf("expected persisted session, got username=%q valid=%v", username, valid)
	}
}

func TestRoomAndMembershipSurviveHubRestart(t *testing.T) {
	db := InitDB(filepath.Join(t.TempDir(), "rooms.db"))
	defer db.Close()
	InitTracks()
	InitBackgrounds()

	track := GetTracks()[0]
	background := GetBackgrounds()[0]
	startedAt := time.Now().UnixMilli()
	original := &Room{
		ID:           "durable-room",
		Name:         "Durable Room",
		HostID:       "host-client",
		HostUsername: "alice",
		Clients:      make(map[*Client]bool),
		Status:       "playing",
		ActiveTrack:  &track,
		Background:   &background,
		Duration:     600,
		StartedAt:    startedAt,
		PasswordHash: []byte("protected"),
	}
	if err := PersistRoom(original); err != nil {
		t.Fatalf("persist room: %v", err)
	}
	if err := SaveRoomMember(original.ID, "alice", "host-client"); err != nil {
		t.Fatalf("persist membership: %v", err)
	}

	restartedHub := NewHub()
	if err := restartedHub.LoadPersistentRooms(); err != nil {
		t.Fatalf("restore rooms: %v", err)
	}
	restored := restartedHub.Rooms[original.ID]
	if restored == nil {
		t.Fatal("expected room to be restored")
	}
	if restored.Status != "playing" || restored.StartedAt != startedAt {
		t.Fatalf("unexpected restored timing: status=%s startedAt=%d", restored.Status, restored.StartedAt)
	}
	if restored.ActiveTrack == nil || restored.ActiveTrack.ID != track.ID {
		t.Fatalf("unexpected restored track: %+v", restored.ActiveTrack)
	}
	if !IsRoomMember(original.ID, "alice", "host-client") {
		t.Fatal("expected room membership to survive restart")
	}
	if !restartedHub.ValidateRoomAccess(original.ID, "", "alice", "host-client") {
		t.Fatal("expected persisted member to re-enter protected room without another password")
	}
}

func TestExpiredMeditationRestoresAsFinished(t *testing.T) {
	db := InitDB(filepath.Join(t.TempDir(), "expired-room.db"))
	defer db.Close()
	InitTracks()
	InitBackgrounds()

	room := &Room{
		ID:           "expired-room",
		Name:         "Expired Room",
		HostID:       "host-client",
		HostUsername: "alice",
		Clients:      make(map[*Client]bool),
		Status:       "playing",
		Duration:     10,
		StartedAt:    time.Now().Add(-time.Minute).UnixMilli(),
	}
	if err := PersistRoom(room); err != nil {
		t.Fatalf("persist expired room: %v", err)
	}

	restartedHub := NewHub()
	if err := restartedHub.LoadPersistentRooms(); err != nil {
		t.Fatalf("restore rooms: %v", err)
	}
	if restored := restartedHub.Rooms[room.ID]; restored == nil || restored.Status != "finished" {
		t.Fatalf("expected finished room, got %+v", restored)
	}
}
