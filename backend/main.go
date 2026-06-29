package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"

	"meditation-app/room"
)

func main() {
	hub := room.NewHub()
	go hub.Run()

	room.InitTracks()

	authManager := room.NewAuthManager("users.json")
	authManager.EnsureAdminCreated("Pifagor1991GG")

	// CORS wrapper
	enableCORS := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}

			next.ServeHTTP(w, r)
		})
	}

	// Tracks endpoint (GET to list, POST to add, DELETE to delete)
	http.Handle("/api/tracks", enableCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			tracks := room.GetTracks()
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(tracks)

		case http.MethodPost:
			token := r.Header.Get("Authorization")
			if token == "" {
				token = r.URL.Query().Get("token")
			} else {
				token = strings.TrimPrefix(token, "Bearer ")
			}

			username, valid := authManager.ValidateToken(token)
			if !valid || username != "admin" {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				json.NewEncoder(w).Encode(map[string]string{"error": "Unauthorized. Admin privileges required."})
				return
			}

			var payload struct {
				Title    string `json:"title"`
				Artist   string `json:"artist"`
				AudioURL string `json:"audioUrl"`
				Duration int    `json:"duration"`
			}

			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}

			newTrack, err := room.AddTrack(payload.Title, payload.Artist, payload.AudioURL, payload.Duration)
			if err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
				return
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(newTrack)

		case http.MethodDelete:
			token := r.Header.Get("Authorization")
			if token == "" {
				token = r.URL.Query().Get("token")
			} else {
				token = strings.TrimPrefix(token, "Bearer ")
			}

			username, valid := authManager.ValidateToken(token)
			if !valid || username != "admin" {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				json.NewEncoder(w).Encode(map[string]string{"error": "Unauthorized. Admin privileges required."})
				return
			}

			trackID := r.URL.Query().Get("id")
			if trackID == "" {
				http.Error(w, "Missing id parameter", http.StatusBadRequest)
				return
			}

			err := room.DeleteTrack(trackID)
			if err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
				return
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
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

	// Register endpoint
	http.Handle("/api/register", enableCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var payload struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		token, err := authManager.Register(payload.Username, payload.Password)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"username": strings.TrimSpace(payload.Username), "token": token})
	})))

	// Login endpoint
	http.Handle("/api/login", enableCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var payload struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		token, err := authManager.Login(payload.Username, payload.Password)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		username, _ := authManager.ValidateToken(token)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"username": username, "token": token})
	})))

	// Verify session token endpoint
	http.Handle("/api/verify", enableCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var payload struct {
			Token string `json:"token"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		username, valid := authManager.ValidateToken(payload.Token)
		if !valid {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]bool{"valid": false})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"valid": true, "username": username})
	})))

	// WebSocket upgrade endpoint
	http.Handle("/ws", enableCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		roomID := r.URL.Query().Get("roomId")
		token := r.URL.Query().Get("token")
		clientID := r.URL.Query().Get("clientId")
		roomName := r.URL.Query().Get("roomName")
		durationStr := r.URL.Query().Get("duration")
		trackID := r.URL.Query().Get("trackId")

		if roomID == "" || token == "" || clientID == "" {
			http.Error(w, "Missing roomId, token, or clientId parameters", http.StatusBadRequest)
			return
		}

		username, valid := authManager.ValidateToken(token)
		if !valid {
			http.Error(w, "Unauthorized session", http.StatusUnauthorized)
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
