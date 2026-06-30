package handlers

import (
	"net/http"
	"strings"

	"meditation-app/room"

	"github.com/gin-gonic/gin"
)

// RegisterHandler handles POST /api/register
func RegisterHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		var payload struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := c.ShouldBindJSON(&payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		token, err := authManager.Register(payload.Username, payload.Password)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"username": strings.TrimSpace(payload.Username),
			"token":    token,
		})
	}
}

// LoginHandler handles POST /api/login
func LoginHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		var payload struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := c.ShouldBindJSON(&payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		token, err := authManager.Login(payload.Username, payload.Password)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
			return
		}

		username, _ := authManager.ValidateToken(token)
		c.JSON(http.StatusOK, gin.H{
			"username": username,
			"token":    token,
		})
	}
}

// VerifyHandler handles POST /api/verify
func VerifyHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		var payload struct {
			Token string `json:"token"`
		}
		if err := c.ShouldBindJSON(&payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		username, valid := authManager.ValidateToken(payload.Token)
		if !valid {
			c.JSON(http.StatusUnauthorized, gin.H{"valid": false})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"valid":    true,
			"username": username,
		})
	}
}

// LogoutHandler revokes a durable session token.
func LogoutHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		authManager.Logout(token)
		c.JSON(http.StatusOK, gin.H{"status": "logged_out"})
	}
}
