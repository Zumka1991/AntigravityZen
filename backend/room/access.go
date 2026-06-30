package room

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type RoomAccessTicket struct {
	RoomID    string
	Username  string
	ClientID  string
	ExpiresAt time.Time
}

func randomAccessTicket() string {
	value := make([]byte, 24)
	if _, err := rand.Read(value); err != nil {
		return ""
	}
	return hex.EncodeToString(value)
}

func (h *Hub) PrepareRoomAccess(roomID, password, username, clientID string, creating bool) (string, error) {
	if roomID == "" || clientID == "" {
		return "", errors.New("missing room or client identifier")
	}

	h.Mutex.Lock()
	defer h.Mutex.Unlock()
	h.cleanupExpiredTicketsLocked()

	var passwordHash []byte
	if existingRoom, exists := h.Rooms[roomID]; exists {
		existingRoom.Mutex.RLock()
		passwordHash = existingRoom.PasswordHash
		existingRoom.Mutex.RUnlock()
		if len(passwordHash) == 0 {
			return "", nil
		}
		if bcrypt.CompareHashAndPassword(passwordHash, []byte(password)) != nil {
			return "", errors.New("invalid room password")
		}
	} else if creating {
		if len(password) < 4 {
			return "", errors.New("room password must be at least 4 characters")
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if err != nil {
			return "", errors.New("could not protect room")
		}
		h.PendingPasswords[roomID] = hash
	} else {
		return "", errors.New("room not found")
	}

	ticket := randomAccessTicket()
	if ticket == "" {
		return "", errors.New("could not create access ticket")
	}
	h.AccessTickets[ticket] = RoomAccessTicket{
		RoomID: roomID, Username: username, ClientID: clientID,
		ExpiresAt: time.Now().Add(45 * time.Second),
	}
	return ticket, nil
}

func (h *Hub) ValidateRoomAccess(roomID, ticket, username, clientID string) bool {
	h.Mutex.Lock()
	defer h.Mutex.Unlock()
	h.cleanupExpiredTicketsLocked()

	protected := len(h.PendingPasswords[roomID]) > 0
	if existingRoom, exists := h.Rooms[roomID]; exists {
		existingRoom.Mutex.RLock()
		protected = len(existingRoom.PasswordHash) > 0
		existingRoom.Mutex.RUnlock()
	}
	if !protected {
		return true
	}

	access, exists := h.AccessTickets[ticket]
	if !exists || access.RoomID != roomID || access.Username != username || access.ClientID != clientID {
		return false
	}
	delete(h.AccessTickets, ticket)
	return true
}

func (h *Hub) cleanupExpiredTicketsLocked() {
	now := time.Now()
	for ticket, access := range h.AccessTickets {
		if now.After(access.ExpiresAt) {
			delete(h.AccessTickets, ticket)
			if _, roomExists := h.Rooms[access.RoomID]; !roomExists {
				delete(h.PendingPasswords, access.RoomID)
			}
		}
	}
}
