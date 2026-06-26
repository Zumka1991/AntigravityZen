package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"meditation-app/room"
)

func main() {
	hub := room.NewHub()
	go hub.Run()

	// CORS wrapper
	enableCORS := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}

			next.ServeHTTP(w, r)
		})
	}

	// Tracks endpoint
	http.Handle("/api/tracks", enableCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tracks := room.GetTracks()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(tracks)
	})))

	// Rooms endpoint - returns list of active rooms
	http.Handle("/api/rooms", enableCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.Mutex.RLock()
		defer hub.Mutex.RUnlock()

		type RoomInfo struct {
			ID          string      `json:"id"`
			Name        string      `json:"name"`
			HostID      string      `json:"hostId"`
			MemberCount int         `json:"memberCount"`
			Status      string      `json:"status"`
			ActiveTrack *room.Track `json:"activeTrack,omitempty"`
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
			})
			rm.Mutex.RUnlock()
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(rooms)
	})))

	// WebSocket upgrade endpoint
	http.Handle("/ws", enableCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		roomID := r.URL.Query().Get("roomId")
		username := r.URL.Query().Get("username")
		clientID := r.URL.Query().Get("clientId")
		roomName := r.URL.Query().Get("roomName")
		durationStr := r.URL.Query().Get("duration")
		trackID := r.URL.Query().Get("trackId")

		if roomID == "" || username == "" || clientID == "" {
			http.Error(w, "Missing roomId, username, or clientId parameters", http.StatusBadRequest)
			return
		}

		duration := 0
		if durationStr != "" {
			if d, err := strconv.Atoi(durationStr); err == nil {
				duration = d
			}
		}

		room.ServeWs(hub, w, r, roomID, username, clientID, roomName, duration, trackID)
	})))

	log.Println("Server started on :8080")
	err := http.ListenAndServe(":8080", nil)
	if err != nil {
		log.Fatal("ListenAndServe: ", err)
	}
}
