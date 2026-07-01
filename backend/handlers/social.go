package handlers

import (
	"database/sql"
	"net/http"
	"strings"

	"meditation-app/room"

	"github.com/gin-gonic/gin"
)

func registeredUsername(c *gin.Context, authManager *room.AuthManager) (string, bool) {
	token := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
	username, isGuest, valid := authManager.ValidateSession(token)
	if !valid {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return "", false
	}
	if isGuest {
		c.JSON(http.StatusForbidden, gin.H{"error": "registration required"})
		return "", false
	}
	return username, true
}

func ListProfilesHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		username, ok := registeredUsername(c, authManager)
		if !ok {
			return
		}
		profiles, err := room.ListUserProfiles(username, c.Query("q"))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load profiles"})
			return
		}
		c.JSON(http.StatusOK, profiles)
	}
}

func GetProfileHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		username, ok := registeredUsername(c, authManager)
		if !ok {
			return
		}
		profile, err := room.GetUserProfile(username, c.Param("username"))
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load profile"})
			return
		}
		c.JSON(http.StatusOK, profile)
	}
}

func SetProfileLikeHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		username, ok := registeredUsername(c, authManager)
		if !ok {
			return
		}
		var payload struct {
			Liked bool `json:"liked"`
		}
		if err := c.ShouldBindJSON(&payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid like"})
			return
		}
		if err := room.SetProfileLike(c.Param("username"), username, payload.Liked); err != nil {
			status := http.StatusBadRequest
			if err == sql.ErrNoRows {
				status = http.StatusNotFound
			}
			c.JSON(status, gin.H{"error": err.Error()})
			return
		}
		profile, _ := room.GetUserProfile(username, c.Param("username"))
		c.JSON(http.StatusOK, profile)
	}
}

func ListConversationsHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		username, ok := registeredUsername(c, authManager)
		if !ok {
			return
		}
		conversations, err := room.ListConversations(username)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load conversations"})
			return
		}
		c.JSON(http.StatusOK, conversations)
	}
}

func ListDirectMessagesHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		username, ok := registeredUsername(c, authManager)
		if !ok {
			return
		}
		messages, err := room.ListDirectMessages(username, c.Param("username"))
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load messages"})
			return
		}
		c.JSON(http.StatusOK, messages)
	}
}

func SendDirectMessageHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		username, ok := registeredUsername(c, authManager)
		if !ok {
			return
		}
		if !room.DMRateLimiter.Allow(username) {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Too many requests. Please try again later."})
			return
		}
		var payload struct {
			Text string `json:"text"`
		}
		if err := c.ShouldBindJSON(&payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid message"})
			return
		}
		message, err := room.AddDirectMessage(username, c.Param("username"), payload.Text)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, message)
	}
}

func DirectMessageNotificationsHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		username, ok := registeredUsername(c, authManager)
		if !ok {
			return
		}
		count, err := room.UnreadDirectMessageCount(username)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load notifications"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"unreadCount": count})
	}
}
