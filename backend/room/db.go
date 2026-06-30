package room

import (
	"database/sql"
	"encoding/json"
	"log"
	"os"

	_ "github.com/mattn/go-sqlite3"
)

var dbConn *sql.DB

// InitDB initializes SQLite and creates tables
func InitDB(dbPath string) *sql.DB {
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}

	// Create tables
	queries := []string{
		`CREATE TABLE IF NOT EXISTS users (
			username TEXT PRIMARY KEY,
			password_hash TEXT NOT NULL,
			salt TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS tracks (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			artist TEXT NOT NULL,
			audio_url TEXT NOT NULL,
			duration INTEGER NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS chats (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			room_id TEXT NOT NULL,
			username TEXT NOT NULL,
			text TEXT NOT NULL,
			timestamp INTEGER NOT NULL
		);`,
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			log.Fatalf("Failed to execute query %q: %v", query, err)
		}
	}

	dbConn = db
	return db
}

// MigrateJSONToDB migrates existing JSON files to SQLite database and renames them to .bak
func MigrateJSONToDB(db *sql.DB) {
	// 1. Migrate Users
	if _, err := os.Stat("users.json"); err == nil {
		var storedUsers map[string]StoredUser
		data, err := os.ReadFile("users.json")
		if err == nil && json.Unmarshal(data, &storedUsers) == nil {
			log.Printf("Migrating users from users.json to SQLite...")
			tx, err := db.Begin()
			if err == nil {
				for _, u := range storedUsers {
					var exists bool
					err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE LOWER(username) = LOWER(?))", u.Username).Scan(&exists)
					if err == nil && !exists {
						_, _ = tx.Exec("INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)", u.Username, u.PasswordHash, u.Salt)
					}
				}
				_ = tx.Commit()
			}
			os.Rename("users.json", "users.json.bak")
		}
	}

	// 2. Migrate Tracks
	if _, err := os.Stat("tracks.json"); err == nil {
		var tracksList []Track
		data, err := os.ReadFile("tracks.json")
		if err == nil && json.Unmarshal(data, &tracksList) == nil {
			log.Printf("Migrating tracks from tracks.json to SQLite...")
			tx, err := db.Begin()
			if err == nil {
				for _, t := range tracksList {
					var exists bool
					err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM tracks WHERE id = ?)", t.ID).Scan(&exists)
					if err == nil && !exists {
						_, _ = tx.Exec("INSERT INTO tracks (id, title, artist, audio_url, duration) VALUES (?, ?, ?, ?, ?)", t.ID, t.Title, t.Artist, t.AudioURL, t.Duration)
					}
				}
				_ = tx.Commit()
			}
			os.Rename("tracks.json", "tracks.json.bak")
		}
	}

	// 3. Migrate Chat History
	if _, err := os.Stat("chat_history.json"); err == nil {
		var chatsHistory map[string][]ChatMessage
		data, err := os.ReadFile("chat_history.json")
		if err == nil && json.Unmarshal(data, &chatsHistory) == nil {
			log.Printf("Migrating chat history from chat_history.json to SQLite...")
			tx, err := db.Begin()
			if err == nil {
				for roomID, messages := range chatsHistory {
					for _, msg := range messages {
						_, _ = tx.Exec("INSERT INTO chats (room_id, username, text, timestamp) VALUES (?, ?, ?, ?)", roomID, msg.Username, msg.Text, msg.Timestamp)
					}
				}
				_ = tx.Commit()
			}
			os.Rename("chat_history.json", "chat_history.json.bak")
		}
	}
}
