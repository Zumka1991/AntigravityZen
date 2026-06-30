package room

import (
	"database/sql"
	"log"
	"time"
)

func nullableTrackID(track *Track) any {
	if track == nil {
		return nil
	}
	return track.ID
}

func nullableBackgroundID(background *MeditationBackground) any {
	if background == nil {
		return nil
	}
	return background.ID
}

// PersistRoom saves a stable room snapshot. Connected clients are intentionally
// not persisted; they reconnect with their durable membership after a restart.
func PersistRoom(room *Room) error {
	if dbConn == nil || room == nil {
		return nil
	}

	room.Mutex.RLock()
	defer room.Mutex.RUnlock()

	_, err := dbConn.Exec(`
		INSERT INTO rooms (
			id, name, host_id, host_username, status, active_track_id,
			voice_track_id, background_id, duration, started_at,
			password_hash, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			host_id = excluded.host_id,
			host_username = excluded.host_username,
			status = excluded.status,
			active_track_id = excluded.active_track_id,
			voice_track_id = excluded.voice_track_id,
			background_id = excluded.background_id,
			duration = excluded.duration,
			started_at = excluded.started_at,
			password_hash = excluded.password_hash,
			updated_at = excluded.updated_at
	`,
		room.ID,
		room.Name,
		room.HostID,
		room.HostUsername,
		room.Status,
		nullableTrackID(room.ActiveTrack),
		nullableTrackID(room.VoiceTrack),
		nullableBackgroundID(room.Background),
		room.Duration,
		room.StartedAt,
		room.PasswordHash,
		time.Now().UnixMilli(),
	)
	return err
}

func SaveRoomMember(roomID, username, clientID string) error {
	if dbConn == nil || roomID == "" || username == "" || clientID == "" {
		return nil
	}
	_, err := dbConn.Exec(`
		INSERT INTO room_members (room_id, username, client_id, joined_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(room_id, username, client_id) DO UPDATE SET
			joined_at = excluded.joined_at
	`, roomID, username, clientID, time.Now().UnixMilli())
	return err
}

func IsRoomMember(roomID, username, clientID string) bool {
	if dbConn == nil {
		return false
	}
	var exists bool
	err := dbConn.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM room_members
			WHERE room_id = ? AND username = ? AND client_id = ?
		)
	`, roomID, username, clientID).Scan(&exists)
	return err == nil && exists
}

func (h *Hub) LoadPersistentRooms() error {
	if dbConn == nil {
		return nil
	}

	rows, err := dbConn.Query(`
		SELECT id, name, host_id, host_username, status,
		       active_track_id, voice_track_id, background_id,
		       duration, started_at, password_hash
		FROM rooms
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	now := time.Now().UnixMilli()
	type restoredTimer struct {
		roomID    string
		startedAt int64
		duration  int
	}
	var timers []restoredTimer

	h.Mutex.Lock()
	defer h.Mutex.Unlock()

	for rows.Next() {
		var (
			id, name, hostID, hostUsername, status    string
			activeTrackID, voiceTrackID, backgroundID sql.NullString
			duration                                  int
			startedAt                                 int64
			passwordHash                              []byte
		)
		if err := rows.Scan(
			&id, &name, &hostID, &hostUsername, &status,
			&activeTrackID, &voiceTrackID, &backgroundID,
			&duration, &startedAt, &passwordHash,
		); err != nil {
			return err
		}

		if status == "playing" && startedAt+int64(duration)*1000 <= now {
			status = "finished"
		}

		room := &Room{
			ID:           id,
			Name:         name,
			HostID:       hostID,
			HostUsername: hostUsername,
			Clients:      make(map[*Client]bool),
			Status:       status,
			Duration:     duration,
			StartedAt:    startedAt,
			PasswordHash: passwordHash,
		}
		if activeTrackID.Valid {
			room.ActiveTrack = FindTrack(activeTrackID.String)
		}
		if voiceTrackID.Valid {
			room.VoiceTrack = FindTrack(voiceTrackID.String)
			if room.VoiceTrack != nil && status == "playing" {
				room.VoiceFilePath = room.VoiceTrack.AudioURL
				room.VoiceStartedAt = startedAt
			}
		}
		if backgroundID.Valid {
			room.Background = FindBackground(backgroundID.String)
		}
		h.Rooms[id] = room

		if status == "playing" {
			timers = append(timers, restoredTimer{id, startedAt, duration})
		} else if status == "finished" {
			_, _ = dbConn.Exec(
				"UPDATE rooms SET status = 'finished', updated_at = ? WHERE id = ?",
				now, id,
			)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, timer := range timers {
		go h.scheduleRoomCompletion(timer.roomID, timer.startedAt, timer.duration)
	}
	log.Printf("Restored %d rooms from SQLite", len(h.Rooms))
	return nil
}

func (h *Hub) scheduleRoomCompletion(roomID string, startedAt int64, duration int) {
	endAt := time.UnixMilli(startedAt).Add(time.Duration(duration) * time.Second)
	if wait := time.Until(endAt); wait > 0 {
		timer := time.NewTimer(wait)
		defer timer.Stop()
		<-timer.C
	}

	h.Mutex.RLock()
	room, exists := h.Rooms[roomID]
	h.Mutex.RUnlock()
	if !exists {
		return
	}

	room.Mutex.Lock()
	if room.Status != "playing" || room.StartedAt != startedAt {
		room.Mutex.Unlock()
		return
	}
	hasVoice := room.VoiceFilePath != ""
	room.Status = "finished"
	room.VoiceFilePath = ""
	room.VoiceStartedAt = 0
	room.Mutex.Unlock()

	if err := PersistRoom(room); err != nil {
		log.Printf("Could not persist completed room %s: %v", roomID, err)
	}
	h.BroadcastRoomState(roomID)
	if hasVoice {
		h.BroadcastVoiceEvent(roomID, "voice_stop", "")
	}
	log.Printf("Meditation naturally completed in room %s", roomID)
}
