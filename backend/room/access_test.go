package room

import (
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestProtectedRoomAccessTicket(t *testing.T) {
	hub := NewHub()

	ticket, err := hub.PrepareRoomAccess("private-room", "quiet123", "alice", "client-1", true)
	if err != nil {
		t.Fatalf("prepare protected room: %v", err)
	}
	if ticket == "" {
		t.Fatal("expected an access ticket")
	}
	if !hub.ValidateRoomAccess("private-room", ticket, "alice", "client-1") {
		t.Fatal("expected valid access ticket")
	}
	if hub.ValidateRoomAccess("private-room", ticket, "alice", "client-1") {
		t.Fatal("access ticket must be single-use")
	}
}

func TestProtectedRoomRejectsWrongPassword(t *testing.T) {
	hub := NewHub()
	hash, err := bcrypt.GenerateFromPassword([]byte("quiet123"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	hub.Rooms["private-room"] = &Room{
		ID:           "private-room",
		Clients:      make(map[*Client]bool),
		PasswordHash: hash,
	}

	if _, err := hub.PrepareRoomAccess("private-room", "wrong", "bob", "client-2", false); err == nil {
		t.Fatal("expected wrong password to be rejected")
	}
}

func TestPublicRoomDoesNotRequireTicket(t *testing.T) {
	hub := NewHub()
	hub.Rooms["public-room"] = &Room{
		ID:      "public-room",
		Clients: make(map[*Client]bool),
	}

	if !hub.ValidateRoomAccess("public-room", "", "alice", "client-1") {
		t.Fatal("public room should not require an access ticket")
	}
}
