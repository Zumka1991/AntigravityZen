package handlers

import (
	"net/http"
	"strconv"

	"meditation-app/room"

	"github.com/gin-gonic/gin"
)

// WSHandler handles GET /ws
func WSHandler(hub *room.Hub, authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		roomID := c.Query("roomId")
		token := c.Query("token")
		clientID := c.Query("clientId")
		roomName := c.Query("roomName")
		durationStr := c.Query("duration")
		trackID := c.Query("trackId")
		voiceTrackID := c.Query("voiceTrackId")
		backgroundID := c.Query("backgroundId")
		accessTicket := c.Query("accessTicket")

		if roomID == "" || token == "" || clientID == "" {
			c.String(http.StatusBadRequest, "Missing roomId, token, or clientId parameters")
			return
		}

		username, valid := authManager.ValidateToken(token)
		if !valid {
			c.String(http.StatusUnauthorized, "Unauthorized session")
			return
		}
		if err := hub.PrepareScheduledRoom(roomID); err != nil {
			c.String(http.StatusInternalServerError, "Could not prepare scheduled room")
			return
		}
		if !hub.ValidateRoomAccess(roomID, accessTicket, username, clientID) {
			c.String(http.StatusForbidden, "Room password required")
			return
		}

		duration := 0
		if durationStr != "" {
			if d, err := strconv.Atoi(durationStr); err == nil {
				duration = d
			}
		}

		room.ServeWs(hub, c.Writer, c.Request, roomID, username, clientID, roomName, duration, trackID, voiceTrackID, backgroundID)
	}
}
