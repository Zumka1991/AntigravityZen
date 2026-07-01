package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"meditation-app/room"

	"github.com/gin-gonic/gin"
)

func TestGuestHandlerUsesHttpOnlyCookieAndRestoresSession(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := room.InitDB(filepath.Join(t.TempDir(), "guest-handler.db"))
	t.Cleanup(func() { _ = db.Close() })
	manager := room.NewAuthManager(db)
	router := gin.New()
	router.POST("/api/guest", GuestHandler(manager))

	first := httptest.NewRecorder()
	router.ServeHTTP(first, httptest.NewRequest(http.MethodPost, "/api/guest", nil))
	if first.Code != http.StatusCreated {
		t.Fatalf("first status = %d", first.Code)
	}
	setCookie := first.Header().Get("Set-Cookie")
	if !strings.Contains(setCookie, "HttpOnly") || !strings.Contains(setCookie, "SameSite=Lax") {
		t.Fatalf("guest cookie is not protected: %q", setCookie)
	}

	var firstPayload struct {
		Username string `json:"username"`
		Token    string `json:"token"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &firstPayload); err != nil {
		t.Fatal(err)
	}

	secondRequest := httptest.NewRequest(http.MethodPost, "/api/guest", nil)
	secondRequest.Header.Set("Cookie", strings.Split(setCookie, ";")[0])
	second := httptest.NewRecorder()
	router.ServeHTTP(second, secondRequest)
	if second.Code != http.StatusOK {
		t.Fatalf("restored status = %d", second.Code)
	}

	var secondPayload struct {
		Username string `json:"username"`
		Token    string `json:"token"`
	}
	if err := json.Unmarshal(second.Body.Bytes(), &secondPayload); err != nil {
		t.Fatal(err)
	}
	if secondPayload.Username != firstPayload.Username || secondPayload.Token != firstPayload.Token {
		t.Fatalf("guest identity changed: first=%+v second=%+v", firstPayload, secondPayload)
	}
}
