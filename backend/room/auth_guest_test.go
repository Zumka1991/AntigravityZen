package room

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestGuestSessionHasServerOwnedIdentity(t *testing.T) {
	db := InitDB(filepath.Join(t.TempDir(), "guest.db"))
	t.Cleanup(func() { _ = db.Close() })
	manager := NewAuthManager(db)

	username, token, err := manager.CreateGuest()
	if err != nil {
		t.Fatalf("create guest: %v", err)
	}
	if !strings.HasPrefix(username, "Guest-") {
		t.Fatalf("unexpected guest username %q", username)
	}

	validatedUsername, isGuest, valid := manager.ValidateSession(token)
	if !valid || !isGuest || validatedUsername != username {
		t.Fatalf("unexpected session: username=%q guest=%v valid=%v", validatedUsername, isGuest, valid)
	}
}

func TestRegisteredUsersCannotClaimGuestNamespace(t *testing.T) {
	db := InitDB(filepath.Join(t.TempDir(), "reserved.db"))
	t.Cleanup(func() { _ = db.Close() })
	manager := NewAuthManager(db)

	if _, err := manager.Register("Guest-ABC123", "quiet123"); err == nil {
		t.Fatal("expected guest namespace to be reserved")
	}
}
