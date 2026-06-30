package handlers

import (
	"net/http"

	"meditation-app/room"

	"github.com/gin-gonic/gin"
)

// GetRoomsHandler handles GET /api/rooms
func GetRoomsHandler(hub *room.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		hub.Mutex.RLock()
		defer hub.Mutex.RUnlock()

		type RoomInfo struct {
			ID          string                     `json:"id"`
			Name        string                     `json:"name"`
			HostID      string                     `json:"hostId"`
			MemberCount int                        `json:"memberCount"`
			Status      string                     `json:"status"`
			ActiveTrack *room.Track                `json:"activeTrack,omitempty"`
			Background  *room.MeditationBackground `json:"background,omitempty"`
		}

		rooms := make([]RoomInfo, 0, len(hub.Rooms))
		for _, rm := range hub.Rooms {
			rm.Mutex.RLock()
			rooms = append(rooms, RoomInfo{
				ID:          rm.ID,
				Name:        rm.Name,
				HostID:      rm.HostID,
				MemberCount: len(rm.Clients),
				Status:      rm.Status,
				ActiveTrack: rm.ActiveTrack,
				Background:  rm.Background,
			})
			rm.Mutex.RUnlock()
		}

		c.JSON(http.StatusOK, rooms)
	}
}
