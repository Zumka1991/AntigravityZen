package room

import (
	"path/filepath"
	"testing"
	"time"
)

func TestLastExplicitLeaveDeletesRoomAndPersistence(t *testing.T) {
	db := InitDB(filepath.Join(t.TempDir(), "empty-room.db"))
	defer db.Close()

	hub := NewHub()
	client := &Client{
		Hub:      hub,
		RoomID:   "leave-room",
		ID:       "client-1",
		Username: "alice",
		Send:     make(chan []byte, 1),
	}
	rm := &Room{
		ID:           client.RoomID,
		Name:         "Leave Room",
		HostID:       client.ID,
		HostUsername: client.Username,
		Clients:      map[*Client]bool{client: true},
		Status:       "lobby",
	}
	hub.Rooms[rm.ID] = rm
	if err := PersistRoom(rm); err != nil {
		t.Fatalf("persist room: %v", err)
	}
	if err := SaveRoomMember(rm.ID, client.Username, client.ID); err != nil {
		t.Fatalf("persist membership: %v", err)
	}

	hub.removeClientPermanently(client)

	if _, exists := hub.Rooms[rm.ID]; exists {
		t.Fatal("expected empty room to be removed from hub")
	}
	var roomCount int
	if err := db.QueryRow("SELECT COUNT(*) FROM rooms WHERE id = ?", rm.ID).Scan(&roomCount); err != nil {
		t.Fatal(err)
	}
	if roomCount != 0 {
		t.Fatalf("expected persisted room to be deleted, count=%d", roomCount)
	}
	if IsRoomMember(rm.ID, client.Username, client.ID) {
		t.Fatal("expected persisted membership to be deleted")
	}
}

func TestReconnectCancelsAbandonedRoomCleanup(t *testing.T) {
	db := InitDB(filepath.Join(t.TempDir(), "reconnect-room.db"))
	defer db.Close()

	hub := NewHub()
	rm := &Room{
		ID:         "reconnect-room",
		Name:       "Reconnect Room",
		Clients:    make(map[*Client]bool),
		Status:     "lobby",
		EmptySince: time.Now().UnixMilli(),
	}
	hub.Rooms[rm.ID] = rm
	if err := PersistRoom(rm); err != nil {
		t.Fatal(err)
	}

	go hub.scheduleEmptyRoomCleanup(rm.ID, rm.EmptySince, 20*time.Millisecond)
	rm.Mutex.Lock()
	rm.Clients[&Client{ID: "reconnected"}] = true
	rm.EmptySince = 0
	rm.Mutex.Unlock()
	time.Sleep(40 * time.Millisecond)

	if _, exists := hub.Rooms[rm.ID]; !exists {
		t.Fatal("reconnected room must not be deleted")
	}
}
