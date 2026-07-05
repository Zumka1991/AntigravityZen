package handlers

import (
	"net/http"
	"os"
	"strconv"
	"strings"

	"meditation-app/room"

	"github.com/gin-gonic/gin"
)

// configuredAdminUsername reads the ADMIN_USERNAME env var with the original
// "admin" fallback. Used to gate admin-only endpoints without exposing any
// new auth machinery to the public.
func configuredAdminUsername() string {
	if v := strings.TrimSpace(os.Getenv("ADMIN_USERNAME")); v != "" {
		return v
	}
	return "admin"
}

// requireAdmin guards a handler so only the configured admin can invoke it.
// Otherwise it writes a 401/403 response and returns false.
func requireAdmin(c *gin.Context, authManager *room.AuthManager) (string, bool) {
	token := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
	username, valid := authManager.ValidateToken(token)
	if !valid {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return "", false
	}
	if !strings.EqualFold(username, configuredAdminUsername()) {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return "", false
	}
	return username, true
}

// BotSettingsResponse is the admin-facing view of bot state. The is_bot flag
// never leaks outside this response.
type BotSettingsResponse struct {
	Enabled       bool              `json:"enabled"`
	MaxConcurrent int               `json:"maxConcurrent"`
	ActiveCount   int               `json:"activeCount"`
	Bots          []string          `json:"bots"`
	ActiveRooms   map[string]string `json:"activeRooms"`
}

// GetBotSettingsHandler returns the current bot configuration plus live state
// (how many bots are currently meditating). Admin only.
func GetBotSettingsHandler(authManager *room.AuthManager, botManager *room.BotManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, ok := requireAdmin(c, authManager); !ok {
			return
		}
		bots, _ := authManager.ListBotUsernames()
		if bots == nil {
			bots = []string{}
		}
		active := botManager.Sessions()
		c.JSON(http.StatusOK, BotSettingsResponse{
			Enabled:       room.SettingBool(room.SettingBotsEnabled, false),
			MaxConcurrent: room.SettingInt(room.SettingBotsMaxConcurrent, 0),
			ActiveCount:   len(active),
			Bots:          bots,
			ActiveRooms:   active,
		})
	}
}

// UpdateBotSettingsHandler mutates the bot toggles. Empty fields are ignored.
// Out-of-range maxConcurrent values are clamped to [0, 25].
func UpdateBotSettingsHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, ok := requireAdmin(c, authManager); !ok {
			return
		}
		var payload struct {
			Enabled       *bool `json:"enabled"`
			MaxConcurrent *int  `json:"maxConcurrent"`
		}
		if err := c.ShouldBindJSON(&payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
			return
		}
		if payload.Enabled != nil {
			val := "false"
			if *payload.Enabled {
				val = "true"
			}
			if err := room.SetSetting(room.SettingBotsEnabled, val); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update enabled flag"})
				return
			}
		}
		if payload.MaxConcurrent != nil {
			n := *payload.MaxConcurrent
			if n < 0 {
				n = 0
			}
			if n > 25 {
				n = 25
			}
			if err := room.SetSetting(room.SettingBotsMaxConcurrent, strconv.Itoa(n)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update max concurrent"})
				return
			}
		}
		// Echo back the latest values so the frontend can refresh.
		c.JSON(http.StatusOK, gin.H{
			"enabled":       room.SettingBool(room.SettingBotsEnabled, false),
			"maxConcurrent": room.SettingInt(room.SettingBotsMaxConcurrent, 0),
		})
	}
}
