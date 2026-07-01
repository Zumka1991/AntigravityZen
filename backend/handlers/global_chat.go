package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"meditation-app/room"

	"github.com/gin-gonic/gin"
)

// GetGlobalChatHandler returns recent messages or messages after the supplied cursor.
func GetGlobalChatHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, valid := authenticateUser(c, authManager); !valid {
			return
		}

		afterID, _ := strconv.ParseInt(c.Query("after"), 10, 64)
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		messages, err := room.GetGlobalChatMessages(afterID, limit)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load chat messages"})
			return
		}

		c.JSON(http.StatusOK, messages)
	}
}

// AddGlobalChatMessageHandler stores a new message for all users.
func AddGlobalChatMessageHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		username, valid := authenticateUser(c, authManager)
		if !valid {
			return
		}
		if !room.GlobalChatRateLimiter.Allow(username) {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Too many requests. Please try again later."})
			return
		}

		var payload struct {
			Text string `json:"text"`
		}
		if err := c.ShouldBindJSON(&payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid message"})
			return
		}
		payload.Text = strings.TrimSpace(payload.Text)

		message, err := room.AppendGlobalChatMessage(username, payload.Text)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusCreated, message)
	}
}
