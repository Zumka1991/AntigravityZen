package handlers

import (
	"net/http"

	"meditation-app/room"

	"github.com/gin-gonic/gin"
)

func RoomAccessHandler(hub *room.Hub, authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := c.GetHeader("Authorization")
		if len(token) > 7 && token[:7] == "Bearer " {
			token = token[7:]
		}
		username, valid := authManager.ValidateToken(token)
		if !valid {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		var request struct {
			RoomID   string `json:"roomId"`
			Password string `json:"password"`
			ClientID string `json:"clientId"`
			Creating bool   `json:"creating"`
		}
		if c.ShouldBindJSON(&request) != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}

		ticket, err := hub.PrepareRoomAccess(request.RoomID, request.Password, username, request.ClientID, request.Creating)
		if err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ticket": ticket})
	}
}
