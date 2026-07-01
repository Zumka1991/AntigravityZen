package handlers

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"meditation-app/room"

	"github.com/gin-gonic/gin"
)

const guestCookieName = "zen_guest_session"

func setGuestCookie(c *gin.Context, token string, maxAge int) {
	secure := c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https")
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(guestCookieName, token, maxAge, "/", "", secure, true)
}

// GuestHandler creates an anonymous session so the application is usable before registration.
func GuestHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		if savedToken, err := c.Cookie(guestCookieName); err == nil {
			if username, isGuest, valid := authManager.ValidateSession(savedToken); valid && isGuest {
				setGuestCookie(c, savedToken, int((30*24*time.Hour)/time.Second))
				c.JSON(http.StatusOK, gin.H{
					"username": username,
					"token":    savedToken,
					"isGuest":  true,
				})
				return
			}
		}

		if !room.AuthIPRateLimiter.Allow(c.ClientIP()) {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Too many requests. Please try again later."})
			return
		}

		username, token, err := authManager.CreateGuest()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not start guest session"})
			return
		}
		setGuestCookie(c, token, int((30*24*time.Hour)/time.Second))
		c.JSON(http.StatusCreated, gin.H{
			"username": username,
			"token":    token,
			"isGuest":  true,
		})
	}
}

type googleCaptchaResponse struct {
	Success     bool     `json:"success"`
	ChallengeTS string   `json:"challenge_ts"`
	Hostname    string   `json:"hostname"`
	ErrorCodes  []string `json:"error-codes"`
}

func verifyCaptcha(token string, clientIP string) bool {
	if gin.Mode() == gin.TestMode {
		return true
	}

	secret := os.Getenv("RECAPTCHA_SECRET")
	if secret == "" {
		secret = "6Lcgaz8tAAAAANo__7VcaXtcpbv9wedWd63SyodK"
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.PostForm("https://www.google.com/recaptcha/api/siteverify", url.Values{
		"secret":   {secret},
		"response": {token},
		"remoteip": {clientIP},
	})
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	var verifyResp googleCaptchaResponse
	if err := json.NewDecoder(resp.Body).Decode(&verifyResp); err != nil {
		return false
	}
	return verifyResp.Success
}

// RegisterHandler handles POST /api/register
func RegisterHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !room.AuthIPRateLimiter.Allow(c.ClientIP()) {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Too many requests. Please try again later."})
			return
		}
		var payload struct {
			Username     string `json:"username"`
			Password     string `json:"password"`
			CaptchaToken string `json:"captchaToken"`
		}
		if err := c.ShouldBindJSON(&payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if !verifyCaptcha(payload.CaptchaToken, c.ClientIP()) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid captcha. Please try again."})
			return
		}

		token, err := authManager.Register(payload.Username, payload.Password)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		setGuestCookie(c, "", -1)

		c.JSON(http.StatusOK, gin.H{
			"username": strings.TrimSpace(payload.Username),
			"token":    token,
			"isGuest":  false,
		})
	}
}

// LoginHandler handles POST /api/login
func LoginHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !room.AuthIPRateLimiter.Allow(c.ClientIP()) {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Too many requests. Please try again later."})
			return
		}
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
		setGuestCookie(c, "", -1)

		username, _ := authManager.ValidateToken(token)
		c.JSON(http.StatusOK, gin.H{
			"username": username,
			"token":    token,
			"isGuest":  false,
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

		username, isGuest, valid := authManager.ValidateSession(payload.Token)
		if !valid {
			c.JSON(http.StatusUnauthorized, gin.H{"valid": false})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"valid":    true,
			"username": username,
			"isGuest":  isGuest,
		})
	}
}

// LogoutHandler revokes a durable session token.
func LogoutHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		authManager.Logout(token)
		setGuestCookie(c, "", -1)
		c.JSON(http.StatusOK, gin.H{"status": "logged_out"})
	}
}
