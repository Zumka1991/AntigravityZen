package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"meditation-app/room"

	"github.com/gin-gonic/gin"
)

func eventUsername(c *gin.Context, authManager *room.AuthManager) (string, bool) {
	token := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
	username, ok := authManager.ValidateToken(token)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
	}
	return username, ok
}

func GetMeditationEventsHandler(hub *room.Hub, authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		username, ok := eventUsername(c, authManager)
		if !ok {
			return
		}
		events, err := room.ListMeditationEvents(username)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load events"})
			return
		}
		for index := range events {
			events[index].HostPresent = hub.IsEventHostPresent(events[index].RoomID, events[index].HostUsername)
		}
		c.JSON(http.StatusOK, events)
	}
}

func CreateMeditationEventHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		username, ok := eventUsername(c, authManager)
		if !ok {
			return
		}
		var payload struct {
			Title        string `json:"title"`
			Description  string `json:"description"`
			StartsAt     int64  `json:"startsAt"`
			Duration     int    `json:"duration"`
			TrackID      string `json:"trackId"`
			VoiceTrackID string `json:"voiceTrackId"`
			BackgroundID string `json:"backgroundId"`
		}
		if err := c.ShouldBindJSON(&payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid event"})
			return
		}
		payload.Title = strings.TrimSpace(payload.Title)
		if payload.Title == "" || payload.StartsAt < time.Now().Add(-time.Minute).UnixMilli() ||
			payload.Duration < 30 || payload.Duration > 4*60*60 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid event details"})
			return
		}

		event := room.MeditationEvent{
			ID: idWithPrefix("evt_"), Title: payload.Title,
			Description:  strings.TrimSpace(payload.Description),
			HostUsername: username, RoomID: idWithPrefix("room_"),
			StartsAt: payload.StartsAt, Duration: payload.Duration,
			TrackID: payload.TrackID, VoiceTrackID: payload.VoiceTrackID,
			BackgroundID: payload.BackgroundID,
		}
		if err := room.CreateMeditationEvent(event); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create event"})
			return
		}
		// The host is always counted as attending.
		_ = room.SetMeditationEventAttendance(event.ID, username, true)
		events, _ := room.ListMeditationEvents(username)
		for _, created := range events {
			if created.ID == event.ID {
				c.JSON(http.StatusCreated, created)
				return
			}
		}
		c.JSON(http.StatusCreated, event)
	}
}

func SetMeditationEventAttendanceHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		username, ok := eventUsername(c, authManager)
		if !ok {
			return
		}
		var payload struct {
			Attending bool `json:"attending"`
		}
		if err := c.ShouldBindJSON(&payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid attendance"})
			return
		}
		if err := room.SetMeditationEventAttendance(c.Param("id"), username, payload.Attending); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update attendance"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"attending": payload.Attending})
	}
}

func DeleteMeditationEventHandler(authManager *room.AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		username, ok := eventUsername(c, authManager)
		if !ok {
			return
		}
		deleted, err := room.DeleteMeditationEvent(c.Param("id"), username)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete event"})
			return
		}
		if !deleted {
			c.JSON(http.StatusForbidden, gin.H{"error": "only the host can delete this event"})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

func idWithPrefix(prefix string) string {
	bytes := make([]byte, 8)
	if _, err := rand.Read(bytes); err != nil {
		return prefix + hex.EncodeToString([]byte(time.Now().String()))[:16]
	}
	return prefix + hex.EncodeToString(bytes)
}
