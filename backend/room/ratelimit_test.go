package room

import (
	"testing"
	"time"
)

func TestRateLimiter(t *testing.T) {
	// Rate limiter that allows 2 requests per 100 milliseconds, capacity 2
	rl := NewRateLimiter(50*time.Millisecond, 2)

	// First 2 requests should be allowed (burst)
	if !rl.Allow("user1") {
		t.Fatal("expected first request to be allowed")
	}
	if !rl.Allow("user1") {
		t.Fatal("expected second request to be allowed")
	}

	// Third request should be blocked (capacity exceeded)
	if rl.Allow("user1") {
		t.Fatal("expected third request to be blocked")
	}

	// Wait 60ms to refill 1 token (rate is 50ms)
	time.Sleep(60 * time.Millisecond)

	// Now 1 request should be allowed
	if !rl.Allow("user1") {
		t.Fatal("expected request to be allowed after sleep")
	}

	// Another immediate request should be blocked
	if rl.Allow("user1") {
		t.Fatal("expected immediate next request to be blocked")
	}

	// Different key should have its own separate bucket and be allowed
	if !rl.Allow("user2") {
		t.Fatal("expected request for user2 to be allowed")
	}
}

func TestRoomCreationLimits(t *testing.T) {
	hub := NewHub()

	// Prepare 3 room access tickets for creation
	ticket1, err := hub.PrepareRoomAccess("room-1", "pass123", "alice", "client-1", true)
	if err != nil || ticket1 == "" {
		t.Fatalf("failed to prepare room 1: %v", err)
	}

	ticket2, err := hub.PrepareRoomAccess("room-2", "pass123", "alice", "client-2", true)
	if err != nil || ticket2 == "" {
		t.Fatalf("failed to prepare room 2: %v", err)
	}

	ticket3, err := hub.PrepareRoomAccess("room-3", "pass123", "alice", "client-3", true)
	if err != nil || ticket3 == "" {
		t.Fatalf("failed to prepare room 3: %v", err)
	}

	// Attempting to prepare a 4th room access ticket for creation should be rejected
	_, err = hub.PrepareRoomAccess("room-4", "pass123", "alice", "client-4", true)
	if err == nil {
		t.Fatal("expected 4th room preparation to be rejected due to hosting limit")
	}
	if err.Error() != "you have reached the limit of active rooms you can host (max 3)" {
		t.Fatalf("unexpected error message: %v", err)
	}

	// Simulate connecting to room-1, which creates the room
	hub.Rooms["room-1"] = &Room{
		ID:           "room-1",
		Name:         "Alice's Room 1",
		HostUsername: "alice",
		Clients:      make(map[*Client]bool),
	}

	// Validate access for room-1 consumes the ticket
	if !hub.ValidateRoomAccess("room-1", ticket1, "alice", "client-1") {
		t.Fatal("expected ticket1 validation to succeed")
	}

	// Try again to prepare the 4th room. It should still fail because:
	// - 1 active room ("room-1")
	// - 2 pending tickets ("room-2", "room-3")
	// Total = 3, which is the limit!
	_, err = hub.PrepareRoomAccess("room-4", "pass123", "alice", "client-4", true)
	if err == nil {
		t.Fatal("expected 4th room to still be rejected")
	}

	// Cancel one pending ticket by simulating its expiry or deletion
	// Since ticket1 was validated and deleted, and we have 1 active room ("room-1")
	// and 2 pending tickets ("room-2" and "room-3"), let's delete a pending password directly
	// or wait/clean up.
	// Let's manually delete the ticket for room-2 to simulate expiry
	hub.Mutex.Lock()
	delete(hub.AccessTickets, ticket2)
	hub.Mutex.Unlock()

	// Now total hosted count is: 1 active room ("room-1") + 1 pending ticket ("room-3") = 2.
	// Preparing a 4th room should now be allowed!
	ticket4, err := hub.PrepareRoomAccess("room-4", "pass123", "alice", "client-4", true)
	if err != nil || ticket4 == "" {
		t.Fatalf("failed to prepare room 4 after ticket2 was freed: %v", err)
	}
}
