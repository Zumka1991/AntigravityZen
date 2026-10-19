package handlers

import (
	"net/http"
	"sort"

	"meditation-app/room"

	"github.com/gin-gonic/gin"
)

// GetRoomsHandler handles GET /api/rooms
func GetRoomsHandler(hub *room.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		hub.Mutex.RLock()
		defer hub.Mutex.RUnlock()

		type RoomInfo struct {
			ID           string                     `json:"id"`
			Name         string                     `json:"name"`
			HostID       string                     `json:"hostId"`
			HostUsername string                     `json:"hostUsername,omitempty"`
			MemberCount  int                        `json:"memberCount"`
			Status       string                     `json:"status"`
			ActiveTrack  *room.Track                `json:"activeTrack,omitempty"`
			Background   *room.MeditationBackground `json:"background,omitempty"`
			Duration     int                        `json:"duration,omitempty"`
			StartedAt    int64                      `json:"startedAt,omitempty"`
			IsProtected  bool                       `json:"isProtected"`
			CreatedAt    int64                      `json:"createdAt"`
		}

		rooms := make([]RoomInfo, 0, len(hub.Rooms))
		for _, rm := range hub.Rooms {
			rm.Mutex.RLock()
			rooms = append(rooms, RoomInfo{
				ID:           rm.ID,
				Name:         rm.Name,
				HostID:       rm.HostID,
				HostUsername: rm.HostUsername,
				MemberCount:  len(rm.Clients),
				Status:       rm.Status,
				ActiveTrack:  rm.ActiveTrack,
				Background:   rm.Background,
				Duration:     rm.Duration,
				StartedAt:    rm.StartedAt,
				IsProtected:  len(rm.PasswordHash) > 0,
				CreatedAt:    rm.CreatedAt,
			})
			rm.Mutex.RUnlock()
		}

		// Newest rooms first — Go map iteration order is unstable, so the
		// lobby used to reshuffle on every poll. Stable sort by CreatedAt
		// desc keeps the order consistent across refreshes.
		sort.SliceStable(rooms, func(i, j int) bool {
			return rooms[i].CreatedAt > rooms[j].CreatedAt
		})

		c.JSON(http.StatusOK, rooms)
	}
}
