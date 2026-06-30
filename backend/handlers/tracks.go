package handlers

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"meditation-app/room"

	"github.com/gin-gonic/gin"
)

const maxTrackUploadSize = 100 << 20

// authenticateUser validates a session and returns its username.
func authenticateUser(c *gin.Context, authManager *room.AuthManager) (string, bool) {
	token := c.GetHeader("Authorization")
	if token == "" {
		token = c.Query("token")
	} else {
		token = strings.TrimPrefix(token, "Bearer ")
	}

	username, valid := authManager.ValidateToken(token)
	if !valid {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return "", false
	}
	return username, true
}

// GetTracksHandler handles GET /api/tracks
func GetTracksHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := c.GetHeader("Authorization")
		if token == "" {
			token = c.Query("token")
		} else {
			token = strings.TrimPrefix(token, "Bearer ")
		}

		username, _ := authManager.ValidateToken(token)
		tracks := room.GetTracksForUser(username)
		c.JSON(http.StatusOK, tracks)
	}
}

// AddTrackHandler handles POST /api/tracks
func AddTrackHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		username, valid := authenticateUser(c, authManager)
		if !valid {
			return
		}

		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxTrackUploadSize)
		title := strings.TrimSpace(c.PostForm("title"))
		durationStr := c.PostForm("duration")
		if title == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Title is required"})
			return
		}

		durationNum, err := strconv.Atoi(durationStr)
		if err != nil || durationNum <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Duration must be a positive number"})
			return
		}

		file, err := c.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Missing file parameter"})
			return
		}
		if file.Size > maxTrackUploadSize {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "Audio file must be smaller than 100 MB"})
			return
		}

		allowedExtensions := map[string]bool{
			".mp3":  true,
			".wav":  true,
			".ogg":  true,
			".m4a":  true,
			".aac":  true,
			".flac": true,
			".webm": true,
		}
		extension := strings.ToLower(filepath.Ext(file.Filename))
		if !allowedExtensions[extension] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported audio file format"})
			return
		}

		// Sanitize filename to prevent directory traversal
		cleanFilename := filepath.Base(file.Filename)
		uniqueFilename := fmt.Sprintf("%d_%s", time.Now().UnixNano(), cleanFilename)
		uploadPath := filepath.Join("./uploads", uniqueFilename)

		// Save the file using Gin's built-in helper
		if err := c.SaveUploadedFile(file, uploadPath); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save file on server"})
			return
		}

		audioURL := fmt.Sprintf("/uploads/%s", uniqueFilename)
		newTrack, err := room.AddTrack(title, username, audioURL, durationNum, username, true)
		if err != nil {
			os.Remove(uploadPath) // Clean up file on failure
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, newTrack)
	}
}

// DeleteTrackHandler handles DELETE /api/tracks
func DeleteTrackHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		username, valid := authenticateUser(c, authManager)
		if !valid {
			return
		}

		trackID := c.Query("id")
		if trackID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Missing id parameter"})
			return
		}

		// Find track first to delete its file from uploads folder
		track := room.FindTrack(trackID)
		if track == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Track not found"})
			return
		}
		if username != "admin" && !strings.EqualFold(track.OwnerUsername, username) {
			c.JSON(http.StatusForbidden, gin.H{"error": "You can only delete tracks that you uploaded"})
			return
		}

		var fileToDelete string
		if strings.Contains(track.AudioURL, "/uploads/") {
			parts := strings.Split(track.AudioURL, "/uploads/")
			if len(parts) > 1 {
				fileToDelete = filepath.Join("./uploads", filepath.Base(parts[1]))
			}
		}

		err := room.DeleteTrack(trackID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if fileToDelete != "" {
			os.Remove(fileToDelete) // delete file from disk
		}

		c.JSON(http.StatusOK, gin.H{"status": "deleted"})
	}
}
