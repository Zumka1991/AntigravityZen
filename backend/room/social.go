package room

import (
	"database/sql"
	"errors"
	"strings"
	"time"
)

type UserProfile struct {
	Username          string `json:"username"`
	HostedCount       int    `json:"hostedCount"`
	ParticipatedCount int    `json:"participatedCount"`
	LikesCount        int    `json:"likesCount"`
	LikedByMe         bool   `json:"likedByMe"`
}

type DirectMessage struct {
	ID        int64  `json:"id"`
	Sender    string `json:"sender"`
	Recipient string `json:"recipient"`
	Text      string `json:"text"`
	CreatedAt int64  `json:"createdAt"`
	ReadAt    *int64 `json:"readAt,omitempty"`
}

type Conversation struct {
	Username    string `json:"username"`
	LastMessage string `json:"lastMessage"`
	LastAt      int64  `json:"lastAt"`
	UnreadCount int    `json:"unreadCount"`
}

func RecordRoomParticipation(roomID, username string, wasHost bool) error {
	if dbConn == nil || roomID == "" || username == "" {
		return nil
	}
	_, err := dbConn.Exec(`
		INSERT INTO room_participations (room_id, username, was_host, joined_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(room_id, username) DO UPDATE SET
			was_host = MAX(was_host, excluded.was_host)
	`, roomID, username, wasHost, time.Now().UnixMilli())
	return err
}

func ListUserProfiles(viewer, query string) ([]UserProfile, error) {
	if dbConn == nil {
		return []UserProfile{}, nil
	}
	pattern := "%" + strings.ToLower(strings.TrimSpace(query)) + "%"
	rows, err := dbConn.Query(`
		SELECT u.username,
			COALESCE(SUM(CASE WHEN rp.was_host = 1 THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN rp.was_host = 0 THEN 1 ELSE 0 END), 0),
			(SELECT COUNT(*) FROM profile_likes pl WHERE pl.profile_username = u.username),
			EXISTS(SELECT 1 FROM profile_likes mine
				WHERE mine.profile_username = u.username AND mine.liked_by = ?)
		FROM users u
		LEFT JOIN room_participations rp ON rp.username = u.username
		WHERE LOWER(u.username) LIKE ?
		GROUP BY u.username
		ORDER BY u.username COLLATE NOCASE
		LIMIT 100
	`, viewer, pattern)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	profiles := make([]UserProfile, 0)
	for rows.Next() {
		var profile UserProfile
		if err := rows.Scan(&profile.Username, &profile.HostedCount, &profile.ParticipatedCount,
			&profile.LikesCount, &profile.LikedByMe); err != nil {
			return nil, err
		}
		profiles = append(profiles, profile)
	}
	return profiles, rows.Err()
}

func GetUserProfile(viewer, username string) (UserProfile, error) {
	profiles, err := ListUserProfiles(viewer, username)
	if err != nil {
		return UserProfile{}, err
	}
	for _, profile := range profiles {
		if strings.EqualFold(profile.Username, username) {
			return profile, nil
		}
	}
	return UserProfile{}, sql.ErrNoRows
}

func SetProfileLike(profileUsername, likedBy string, liked bool) error {
	if strings.EqualFold(profileUsername, likedBy) {
		return errors.New("cannot like your own profile")
	}
	var canonical string
	if err := dbConn.QueryRow(
		"SELECT username FROM users WHERE LOWER(username) = LOWER(?)", profileUsername,
	).Scan(&canonical); err != nil {
		return err
	}
	if liked {
		_, err := dbConn.Exec(`
			INSERT OR IGNORE INTO profile_likes (profile_username, liked_by, created_at)
			VALUES (?, ?, ?)
		`, canonical, likedBy, time.Now().UnixMilli())
		return err
	}
	_, err := dbConn.Exec(
		"DELETE FROM profile_likes WHERE profile_username = ? AND liked_by = ?",
		canonical, likedBy,
	)
	return err
}

func AddDirectMessage(sender, recipient, text string) (DirectMessage, error) {
	text = strings.TrimSpace(text)
	if text == "" || len([]rune(text)) > 2000 {
		return DirectMessage{}, errors.New("message must contain 1 to 2000 characters")
	}
	if strings.EqualFold(sender, recipient) {
		return DirectMessage{}, errors.New("cannot message yourself")
	}
	var canonical string
	if err := dbConn.QueryRow(
		"SELECT username FROM users WHERE LOWER(username) = LOWER(?)", recipient,
	).Scan(&canonical); err != nil {
		return DirectMessage{}, err
	}
	createdAt := time.Now().UnixMilli()
	result, err := dbConn.Exec(`
		INSERT INTO direct_messages (sender_username, recipient_username, text, created_at)
		VALUES (?, ?, ?, ?)
	`, sender, canonical, text, createdAt)
	if err != nil {
		return DirectMessage{}, err
	}
	id, _ := result.LastInsertId()
	return DirectMessage{ID: id, Sender: sender, Recipient: canonical, Text: text, CreatedAt: createdAt}, nil
}

func ListDirectMessages(viewer, other string) ([]DirectMessage, error) {
	var canonical string
	if err := dbConn.QueryRow(
		"SELECT username FROM users WHERE LOWER(username) = LOWER(?)", other,
	).Scan(&canonical); err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	if _, err := dbConn.Exec(`
		UPDATE direct_messages SET read_at = ?
		WHERE recipient_username = ? AND sender_username = ? AND read_at IS NULL
	`, now, viewer, canonical); err != nil {
		return nil, err
	}
	rows, err := dbConn.Query(`
		SELECT id, sender_username, recipient_username, text, created_at, read_at
		FROM direct_messages
		WHERE (sender_username = ? AND recipient_username = ?)
		   OR (sender_username = ? AND recipient_username = ?)
		ORDER BY id DESC LIMIT 200
	`, viewer, canonical, canonical, viewer)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	reversed := make([]DirectMessage, 0)
	for rows.Next() {
		var message DirectMessage
		var readAt sql.NullInt64
		if err := rows.Scan(&message.ID, &message.Sender, &message.Recipient, &message.Text,
			&message.CreatedAt, &readAt); err != nil {
			return nil, err
		}
		if readAt.Valid {
			value := readAt.Int64
			message.ReadAt = &value
		}
		reversed = append(reversed, message)
	}
	for left, right := 0, len(reversed)-1; left < right; left, right = left+1, right-1 {
		reversed[left], reversed[right] = reversed[right], reversed[left]
	}
	return reversed, rows.Err()
}

func ListConversations(viewer string) ([]Conversation, error) {
	rows, err := dbConn.Query(`
		WITH mine AS (
			SELECT id, text, created_at, read_at,
				CASE WHEN sender_username = ? THEN recipient_username ELSE sender_username END AS other
			FROM direct_messages
			WHERE sender_username = ? OR recipient_username = ?
		),
		latest AS (
			SELECT other, MAX(id) AS last_id FROM mine GROUP BY other
		)
		SELECT latest.other, mine.text, mine.created_at,
			(SELECT COUNT(*) FROM direct_messages unread
			 WHERE unread.recipient_username = ? AND unread.sender_username = latest.other
			   AND unread.read_at IS NULL)
		FROM latest JOIN mine ON mine.id = latest.last_id
		ORDER BY mine.created_at DESC
	`, viewer, viewer, viewer, viewer)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	conversations := make([]Conversation, 0)
	for rows.Next() {
		var conversation Conversation
		if err := rows.Scan(&conversation.Username, &conversation.LastMessage,
			&conversation.LastAt, &conversation.UnreadCount); err != nil {
			return nil, err
		}
		conversations = append(conversations, conversation)
	}
	return conversations, rows.Err()
}

func UnreadDirectMessageCount(viewer string) (int, error) {
	var count int
	err := dbConn.QueryRow(`
		SELECT COUNT(*) FROM direct_messages
		WHERE recipient_username = ? AND read_at IS NULL
	`, viewer).Scan(&count)
	return count, err
}
