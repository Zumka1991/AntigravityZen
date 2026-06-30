package room

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// MeditationBackground is a visual backdrop shared by everyone in a room.
type MeditationBackground struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	ImageURL   string `json:"imageUrl"`
	IsDefault  bool   `json:"isDefault"`
	UploadedBy string `json:"uploadedBy,omitempty"`
}

var defaultMeditationBackgrounds = []MeditationBackground{
	{ID: "misty-mountains", Title: "Misty Mountains", ImageURL: "/backgrounds/misty-mountains.jpg", IsDefault: true},
	{ID: "moonlit-lake", Title: "Moonlit Lake", ImageURL: "/backgrounds/moonlit-lake.jpg", IsDefault: true},
	{ID: "zen-garden", Title: "Zen Garden", ImageURL: "/backgrounds/zen-garden.jpg", IsDefault: true},
	{ID: "forest-light", Title: "Forest Light", ImageURL: "/backgrounds/forest-light.jpg", IsDefault: true},
	{ID: "cosmic-drift", Title: "Cosmic Drift", ImageURL: "/backgrounds/cosmic-drift.jpg", IsDefault: true},
}

func InitBackgrounds() {
	for _, background := range defaultMeditationBackgrounds {
		if _, err := dbConn.Exec(`
			INSERT INTO meditation_backgrounds (id, title, image_url, is_default, uploaded_by)
			VALUES (?, ?, ?, 1, NULL)
			ON CONFLICT(id) DO UPDATE SET
				title = excluded.title,
				image_url = excluded.image_url,
				is_default = 1,
				uploaded_by = NULL
		`, background.ID, background.Title, background.ImageURL); err != nil {
			fmt.Printf("Failed to initialize background %s: %v\n", background.ID, err)
		}
	}
}

func GetBackgrounds() []MeditationBackground {
	rows, err := dbConn.Query(`
		SELECT id, title, image_url, is_default, IFNULL(uploaded_by, '')
		FROM meditation_backgrounds
		ORDER BY
			is_default DESC,
			CASE id
				WHEN 'misty-mountains' THEN 1
				WHEN 'moonlit-lake' THEN 2
				WHEN 'zen-garden' THEN 3
				WHEN 'forest-light' THEN 4
				WHEN 'cosmic-drift' THEN 5
				ELSE 100
			END,
			title COLLATE NOCASE
	`)
	if err != nil {
		return []MeditationBackground{}
	}
	defer rows.Close()

	backgrounds := make([]MeditationBackground, 0)
	for rows.Next() {
		var background MeditationBackground
		if err := rows.Scan(
			&background.ID,
			&background.Title,
			&background.ImageURL,
			&background.IsDefault,
			&background.UploadedBy,
		); err == nil {
			backgrounds = append(backgrounds, background)
		}
	}
	return backgrounds
}

func FindBackground(id string) *MeditationBackground {
	var background MeditationBackground
	err := dbConn.QueryRow(`
		SELECT id, title, image_url, is_default, IFNULL(uploaded_by, '')
		FROM meditation_backgrounds
		WHERE id = ?
	`, id).Scan(
		&background.ID,
		&background.Title,
		&background.ImageURL,
		&background.IsDefault,
		&background.UploadedBy,
	)
	if err != nil {
		return nil
	}
	return &background
}

func AddBackground(title, imageURL, uploadedBy string) (MeditationBackground, error) {
	title = strings.TrimSpace(title)
	imageURL = strings.TrimSpace(imageURL)
	if title == "" || imageURL == "" {
		return MeditationBackground{}, errors.New("invalid background metadata")
	}

	id := strings.ToLower(title)
	id = strings.ReplaceAll(id, " ", "-")
	var cleanID []rune
	for _, char := range id {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '-' {
			cleanID = append(cleanID, char)
		}
	}
	id = string(cleanID)
	if id == "" {
		id = "background-" + time.Now().Format("20060102150405")
	}

	baseID := id
	for suffix := 1; ; suffix++ {
		var exists bool
		if err := dbConn.QueryRow("SELECT EXISTS(SELECT 1 FROM meditation_backgrounds WHERE id = ?)", id).Scan(&exists); err != nil {
			return MeditationBackground{}, err
		}
		if !exists {
			break
		}
		id = fmt.Sprintf("%s-%d", baseID, suffix)
	}

	background := MeditationBackground{
		ID:         id,
		Title:      title,
		ImageURL:   imageURL,
		UploadedBy: uploadedBy,
	}
	_, err := dbConn.Exec(`
		INSERT INTO meditation_backgrounds (id, title, image_url, is_default, uploaded_by)
		VALUES (?, ?, ?, 0, ?)
	`, background.ID, background.Title, background.ImageURL, background.UploadedBy)
	if err != nil {
		return MeditationBackground{}, err
	}
	return background, nil
}

func DeleteBackground(id string) error {
	result, err := dbConn.Exec("DELETE FROM meditation_backgrounds WHERE id = ? AND is_default = 0", id)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return errors.New("background not found or cannot be deleted")
	}
	return nil
}
