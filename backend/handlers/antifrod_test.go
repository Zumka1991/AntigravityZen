package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"meditation-app/room"

	"github.com/gin-gonic/gin"
)

func TestAuthIPRateLimiting(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := room.InitDB(filepath.Join(t.TempDir(), "auth-rl.db"))
	t.Cleanup(func() { _ = db.Close() })
	manager := room.NewAuthManager(db)
	router := gin.New()
	router.POST("/api/guest", GuestHandler(manager))

	// AuthIPRateLimiter capacity is 5, but let's test it:
	// First 5 guest creations should succeed
	for i := 0; i < 5; i++ {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/guest", nil)
		req.RemoteAddr = "1.2.3.4:1234"
		router.ServeHTTP(w, req)
		if w.Code != http.StatusCreated {
			t.Fatalf("request %d failed with code %d", i, w.Code)
		}
	}

	// 6th request should fail with 429 Too Many Requests
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/guest", nil)
	req.RemoteAddr = "1.2.3.4:1234"
	router.ServeHTTP(w, req)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 Too Many Requests, got %d", w.Code)
	}

	// Different IP should succeed
	w2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPost, "/api/guest", nil)
	req2.RemoteAddr = "5.6.7.8:1234"
	router.ServeHTTP(w2, req2)
	if w2.Code != http.StatusCreated {
		t.Fatalf("request from different IP failed with code %d", w2.Code)
	}
}

func TestDMRateLimiting(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := room.InitDB(filepath.Join(t.TempDir(), "dm-rl.db"))
	t.Cleanup(func() { _ = db.Close() })
	manager := room.NewAuthManager(db)
	router := gin.New()
	router.POST("/api/messages/:username", SendDirectMessageHandler(manager))

	// Register 2 users (sender and recipient)
	senderToken, err := manager.Register("alice", "pass123")
	if err != nil {
		t.Fatal(err)
	}
	_, err = manager.Register("bob", "pass123")
	if err != nil {
		t.Fatal(err)
	}

	// Alice sends direct messages to Bob
	body, _ := json.Marshal(map[string]string{"text": "Hello"})

	// First 5 direct messages should succeed
	for i := 0; i < 5; i++ {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/messages/bob", bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+senderToken)
		router.ServeHTTP(w, req)
		if w.Code != http.StatusCreated {
			t.Fatalf("direct message %d failed with code %d: %s", i, w.Code, w.Body.String())
		}
	}

	// 6th message should fail with 429 Too Many Requests
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/messages/bob", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+senderToken)
	router.ServeHTTP(w, req)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 Too Many Requests, got %d", w.Code)
	}
}

func TestGlobalChatRateLimiting(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := room.InitDB(filepath.Join(t.TempDir(), "global-rl.db"))
	t.Cleanup(func() { _ = db.Close() })
	manager := room.NewAuthManager(db)
	router := gin.New()
	router.POST("/api/global-chat", AddGlobalChatMessageHandler(manager))

	token, err := manager.Register("alice", "pass123")
	if err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]string{"text": "Hello"})

	// First 5 messages should succeed
	for i := 0; i < 5; i++ {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/global-chat", bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		router.ServeHTTP(w, req)
		if w.Code != http.StatusCreated {
			t.Fatalf("message %d failed with code %d: %s", i, w.Code, w.Body.String())
		}
	}

	// 6th message should fail with 429
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/global-chat", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	router.ServeHTTP(w, req)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", w.Code)
	}
}

func TestGuestRestrictions(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := room.InitDB(filepath.Join(t.TempDir(), "guest-restrict.db"))
	t.Cleanup(func() { _ = db.Close() })
	manager := room.NewAuthManager(db)
	router := gin.New()
	router.POST("/api/events", CreateMeditationEventHandler(manager))

	// Create a guest session
	_, guestToken, err := manager.CreateGuest()
	if err != nil {
		t.Fatal(err)
	}

	// Try to schedule event as a guest
	eventPayload, _ := json.Marshal(map[string]any{
		"title":    "My Meditation",
		"startsAt": time.Now().Add(time.Hour).UnixMilli(),
		"duration": 60,
	})

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/events", bytes.NewReader(eventPayload))
	req.Header.Set("Authorization", "Bearer "+guestToken)
	router.ServeHTTP(w, req)

	// Should be forbidden (403)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for guest scheduling, got %d", w.Code)
	}
}
