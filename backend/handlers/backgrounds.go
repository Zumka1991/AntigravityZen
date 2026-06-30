package handlers

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"meditation-app/room"

	"github.com/gin-gonic/gin"
)

const maxBackgroundUploadSize = 15 << 20

func GetBackgroundsHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, valid := authenticateUser(c, authManager); !valid {
			return
		}
		c.JSON(http.StatusOK, room.GetBackgrounds())
	}
}

func AddBackgroundHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		username, valid := authenticateUser(c, authManager)
		if !valid {
			return
		}
		if !strings.EqualFold(username, "admin") {
			c.JSON(http.StatusForbidden, gin.H{"error": "Admin privileges required"})
			return
		}

		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBackgroundUploadSize)
		title := strings.TrimSpace(c.PostForm("title"))
		if title == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Title is required"})
			return
		}

		file, err := c.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Missing image file"})
			return
		}
		if file.Size > maxBackgroundUploadSize {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "Image must be smaller than 15 MB"})
			return
		}

		allowedExtensions := map[string]bool{
			".jpg": true, ".jpeg": true, ".png": true, ".webp": true,
		}
		extension := strings.ToLower(filepath.Ext(file.Filename))
		if !allowedExtensions[extension] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported image format"})
			return
		}

		if err := os.MkdirAll("./uploads/backgrounds", 0755); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to prepare upload directory"})
			return
		}
		filename := fmt.Sprintf("%d%s", time.Now().UnixNano(), extension)
		uploadPath := filepath.Join("./uploads/backgrounds", filename)
		if err := c.SaveUploadedFile(file, uploadPath); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save image"})
			return
		}

		background, err := room.AddBackground(title, "/uploads/backgrounds/"+filename, username)
		if err != nil {
			_ = os.Remove(uploadPath)
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, background)
	}
}

func DeleteBackgroundHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		username, valid := authenticateUser(c, authManager)
		if !valid {
			return
		}
		if !strings.EqualFold(username, "admin") {
			c.JSON(http.StatusForbidden, gin.H{"error": "Admin privileges required"})
			return
		}

		background := room.FindBackground(c.Query("id"))
		if background == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Background not found"})
			return
		}
		if background.IsDefault {
			c.JSON(http.StatusForbidden, gin.H{"error": "Default backgrounds cannot be deleted"})
			return
		}

		if err := room.DeleteBackground(background.ID); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if strings.HasPrefix(background.ImageURL, "/uploads/backgrounds/") {
			_ = os.Remove(filepath.Join("./uploads/backgrounds", filepath.Base(background.ImageURL)))
		}
		c.JSON(http.StatusOK, gin.H{"status": "deleted"})
	}
}
