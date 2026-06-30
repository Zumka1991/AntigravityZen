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

// Helper to authenticate admin
func validateAdmin(c *gin.Context, authManager *room.AuthManager) bool {
	token := c.GetHeader("Authorization")
	if token == "" {
		token = c.Query("token")
	} else {
		token = strings.TrimPrefix(token, "Bearer ")
	}

	username, valid := authManager.ValidateToken(token)
	if !valid || username != "admin" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized. Admin privileges required."})
		return false
	}
	return true
}

// GetTracksHandler handles GET /api/tracks
func GetTracksHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		tracks := room.GetTracks()
		c.JSON(http.StatusOK, tracks)
	}
}

// AddTrackHandler handles POST /api/tracks
func AddTrackHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !validateAdmin(c, authManager) {
			return
		}

		// Parse multipart form (Gin automatically parses it up to 32MB by default, but we can set max memory if needed)
		// We can get form values directly
		title := c.PostForm("title")
		artist := c.PostForm("artist")
		durationStr := c.PostForm("duration")

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
		newTrack, err := room.AddTrack(title, artist, audioURL, durationNum)
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
		if !validateAdmin(c, authManager) {
			return
		}

		trackID := c.Query("id")
		if trackID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Missing id parameter"})
			return
		}

		// Find track first to delete its file from uploads folder
		track := room.FindTrack(trackID)
		var fileToDelete string
		if track != nil {
			if strings.Contains(track.AudioURL, "/uploads/") {
				parts := strings.Split(track.AudioURL, "/uploads/")
				if len(parts) > 1 {
					fileToDelete = filepath.Join("./uploads", parts[1])
				}
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
