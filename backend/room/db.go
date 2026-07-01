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
	dsn := dbPath
	if dbPath != ":memory:" {
		dsn += "?_busy_timeout=5000&_journal_mode=WAL&_synchronous=NORMAL"
	}
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	db.SetMaxOpenConns(10)

	// Create tables
	queries := []string{
		`CREATE TABLE IF NOT EXISTS users (
			username TEXT PRIMARY KEY,
			password_hash TEXT NOT NULL,
			salt TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS sessions (
			token TEXT PRIMARY KEY,
			username TEXT NOT NULL,
			expires_at INTEGER NOT NULL,
			is_guest INTEGER NOT NULL DEFAULT 0
		);`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
			ON sessions(expires_at
		);`,
		`CREATE TABLE IF NOT EXISTS tracks (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			artist TEXT NOT NULL,
			audio_url TEXT NOT NULL,
			duration INTEGER NOT NULL,
			owner_username TEXT,
			is_public INTEGER NOT NULL DEFAULT 0
		);`,
		`CREATE TABLE IF NOT EXISTS chats (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			room_id TEXT NOT NULL,
			username TEXT NOT NULL,
			text TEXT NOT NULL,
			timestamp INTEGER NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS global_chat_messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL,
			text TEXT NOT NULL,
			timestamp INTEGER NOT NULL
		);`,
		`CREATE INDEX IF NOT EXISTS idx_global_chat_messages_id
			ON global_chat_messages(id
		);`,
		`CREATE TABLE IF NOT EXISTS meditation_backgrounds (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			image_url TEXT NOT NULL,
			is_default INTEGER NOT NULL DEFAULT 0,
			uploaded_by TEXT
		);`,
		`CREATE TABLE IF NOT EXISTS rooms (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			host_id TEXT NOT NULL,
			host_username TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL,
			active_track_id TEXT,
			voice_track_id TEXT,
			background_id TEXT,
			duration INTEGER NOT NULL,
			started_at INTEGER NOT NULL DEFAULT 0,
			password_hash BLOB,
			updated_at INTEGER NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS room_members (
			room_id TEXT NOT NULL,
			username TEXT NOT NULL,
			client_id TEXT NOT NULL,
			joined_at INTEGER NOT NULL,
			PRIMARY KEY (room_id, username, client_id)
		);`,
		`CREATE INDEX IF NOT EXISTS idx_room_members_lookup
			ON room_members(room_id, username, client_id
		);`,
		`CREATE TABLE IF NOT EXISTS meditation_events (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			host_username TEXT NOT NULL,
			room_id TEXT NOT NULL UNIQUE,
			starts_at INTEGER NOT NULL,
			duration INTEGER NOT NULL,
			track_id TEXT,
			voice_track_id TEXT,
			background_id TEXT,
			created_at INTEGER NOT NULL
		);`,
		`CREATE INDEX IF NOT EXISTS idx_meditation_events_starts_at
			ON meditation_events(starts_at
		);`,
		`CREATE TABLE IF NOT EXISTS meditation_event_attendees (
			event_id TEXT NOT NULL,
			username TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			PRIMARY KEY (event_id, username),
			FOREIGN KEY (event_id) REFERENCES meditation_events(id) ON DELETE CASCADE
		);`,
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			log.Fatalf("Failed to execute query %q: %v", query, err)
		}
	}

	// Dynamic column migration for tracks table
	var colExists bool
	err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM pragma_table_info('tracks') WHERE name='owner_username')").Scan(&colExists)
	if err == nil && !colExists {
		_, err = db.Exec("ALTER TABLE tracks ADD COLUMN owner_username TEXT")
		if err != nil {
			log.Printf("Error adding owner_username column to tracks table: %v", err)
		} else {
			log.Println("Added owner_username column to tracks table successfully")
		}
	}

	err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM pragma_table_info('tracks') WHERE name='is_public')").Scan(&colExists)
	if err == nil && !colExists {
		_, err = db.Exec("ALTER TABLE tracks ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0")
		if err != nil {
			log.Printf("Error adding is_public column to tracks table: %v", err)
		} else {
			log.Println("Added is_public column to tracks table successfully")
		}
	}

	err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM pragma_table_info('sessions') WHERE name='is_guest')").Scan(&colExists)
	if err == nil && !colExists {
		_, err = db.Exec("ALTER TABLE sessions ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0")
		if err != nil {
			log.Printf("Error adding is_guest column to sessions table: %v", err)
		} else {
			log.Println("Added is_guest column to sessions table successfully")
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
