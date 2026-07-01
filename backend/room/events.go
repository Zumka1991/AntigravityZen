package room

import (
	"database/sql"
	"errors"
	"strings"
	"time"
)

type MeditationEvent struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	Description   string `json:"description"`
	HostUsername  string `json:"hostUsername"`
	RoomID        string `json:"roomId"`
	StartsAt      int64  `json:"startsAt"`
	Duration      int    `json:"duration"`
	TrackID       string `json:"trackId,omitempty"`
	VoiceTrackID  string `json:"voiceTrackId,omitempty"`
	BackgroundID  string `json:"backgroundId,omitempty"`
	AttendeeCount int    `json:"attendeeCount"`
	IsAttending   bool   `json:"isAttending"`
	HostPresent   bool   `json:"hostPresent"`
}

func (h *Hub) IsEventHostPresent(roomID, hostUsername string) bool {
	h.Mutex.RLock()
	eventRoom, exists := h.Rooms[roomID]
	h.Mutex.RUnlock()
	if !exists {
		return false
	}
	eventRoom.Mutex.RLock()
	defer eventRoom.Mutex.RUnlock()
	for client := range eventRoom.Clients {
		if strings.EqualFold(client.Username, hostUsername) {
			return true
		}
	}
	return false
}

func CreateMeditationEvent(event MeditationEvent) error {
	if dbConn == nil {
		return errors.New("database is not initialized")
	}
	_, err := dbConn.Exec(`
		INSERT INTO meditation_events (
			id, title, description, host_username, room_id, starts_at,
			duration, track_id, voice_track_id, background_id, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, event.ID, event.Title, event.Description, event.HostUsername, event.RoomID,
		event.StartsAt, event.Duration, nullableString(event.TrackID),
		nullableString(event.VoiceTrackID), nullableString(event.BackgroundID),
		time.Now().UnixMilli())
	return err
}

func ListMeditationEvents(username string) ([]MeditationEvent, error) {
	if dbConn == nil {
		return nil, errors.New("database is not initialized")
	}
	now := time.Now().UnixMilli()
	rows, err := dbConn.Query(`
		SELECT e.id, e.title, e.description, e.host_username, e.room_id,
		       e.starts_at, e.duration, COALESCE(e.track_id, ''),
		       COALESCE(e.voice_track_id, ''), COALESCE(e.background_id, ''),
		       COUNT(a.username),
		       EXISTS(
		         SELECT 1 FROM meditation_event_attendees mine
		         WHERE mine.event_id = e.id AND LOWER(mine.username) = LOWER(?)
		       )
		FROM meditation_events e
		LEFT JOIN meditation_event_attendees a ON a.event_id = e.id
		WHERE e.starts_at + (e.duration * 1000) > ?
		GROUP BY e.id
		ORDER BY e.starts_at ASC
	`, username, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]MeditationEvent, 0)
	for rows.Next() {
		var event MeditationEvent
		if err := rows.Scan(
			&event.ID, &event.Title, &event.Description, &event.HostUsername,
			&event.RoomID, &event.StartsAt, &event.Duration, &event.TrackID,
			&event.VoiceTrackID, &event.BackgroundID, &event.AttendeeCount,
			&event.IsAttending,
		); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func SetMeditationEventAttendance(eventID, username string, attending bool) error {
	if dbConn == nil {
		return errors.New("database is not initialized")
	}
	if attending {
		_, err := dbConn.Exec(`
			INSERT INTO meditation_event_attendees (event_id, username, created_at)
			VALUES (?, ?, ?)
			ON CONFLICT(event_id, username) DO NOTHING
		`, eventID, username, time.Now().UnixMilli())
		return err
	}
	_, err := dbConn.Exec(
		"DELETE FROM meditation_event_attendees WHERE event_id = ? AND LOWER(username) = LOWER(?)",
		eventID, username,
	)
	return err
}

func DeleteMeditationEvent(eventID, username string) (bool, error) {
	if dbConn == nil {
		return false, errors.New("database is not initialized")
	}
	tx, err := dbConn.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	var exists bool
	if err := tx.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM meditation_events
			WHERE id = ? AND LOWER(host_username) = LOWER(?)
		)
	`, eventID, username).Scan(&exists); err != nil || !exists {
		return false, err
	}
	if _, err := tx.Exec("DELETE FROM meditation_event_attendees WHERE event_id = ?", eventID); err != nil {
		return false, err
	}
	result, err := tx.Exec("DELETE FROM meditation_events WHERE id = ?", eventID)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil || affected == 0 {
		return false, err
	}
	return true, tx.Commit()
}

// CompleteMeditationEventByRoom removes a scheduled event from the upcoming
// poster as soon as its actual room finishes, including an early host stop.
func CompleteMeditationEventByRoom(roomID string) error {
	if dbConn == nil || roomID == "" {
		return nil
	}
	tx, err := dbConn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`
		DELETE FROM meditation_event_attendees
		WHERE event_id IN (SELECT id FROM meditation_events WHERE room_id = ?)
	`, roomID); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM meditation_events WHERE room_id = ?", roomID); err != nil {
		return err
	}
	return tx.Commit()
}

func FindMeditationEventByRoom(roomID string) (*MeditationEvent, error) {
	if dbConn == nil {
		return nil, errors.New("database is not initialized")
	}
	var event MeditationEvent
	err := dbConn.QueryRow(`
		SELECT id, title, description, host_username, room_id, starts_at,
		       duration, COALESCE(track_id, ''), COALESCE(voice_track_id, ''),
		       COALESCE(background_id, '')
		FROM meditation_events WHERE room_id = ?
	`, roomID).Scan(
		&event.ID, &event.Title, &event.Description, &event.HostUsername,
		&event.RoomID, &event.StartsAt, &event.Duration, &event.TrackID,
		&event.VoiceTrackID, &event.BackgroundID,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &event, err
}

func (h *Hub) PrepareScheduledRoom(roomID string) error {
	h.Mutex.RLock()
	_, exists := h.Rooms[roomID]
	h.Mutex.RUnlock()
	if exists {
		return nil
	}

	event, err := FindMeditationEventByRoom(roomID)
	if err != nil || event == nil {
		return err
	}

	h.Mutex.Lock()
	defer h.Mutex.Unlock()
	if _, exists := h.Rooms[roomID]; exists {
		return nil
	}
	h.Rooms[roomID] = &Room{
		ID:           event.RoomID,
		Name:         event.Title,
		HostUsername: event.HostUsername,
		Clients:      make(map[*Client]bool),
		Status:       "lobby",
		ActiveTrack:  FindTrack(event.TrackID),
		VoiceTrack:   FindTrack(event.VoiceTrackID),
		Background:   FindBackground(event.BackgroundID),
		Duration:     event.Duration,
	}
	return nil
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}
