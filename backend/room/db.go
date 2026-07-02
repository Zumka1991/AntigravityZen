package room

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	_ "github.com/mattn/go-sqlite3"
)

// DB keeps application queries portable: the codebase uses ? placeholders,
// while PostgreSQL requires $1, $2, ... placeholders.
type DB struct {
	raw     *sql.DB
	dialect string
}

type Tx struct {
	raw     *sql.Tx
	dialect string
}

var dbConn *DB

func rebind(query, dialect string) string {
	if dialect != "postgres" {
		return query
	}
	var builder strings.Builder
	arg := 1
	for _, char := range query {
		if char == '?' {
			fmt.Fprintf(&builder, "$%d", arg)
			arg++
		} else {
			builder.WriteRune(char)
		}
	}
	return builder.String()
}

func (db *DB) Exec(query string, args ...any) (sql.Result, error) {
	return db.raw.Exec(rebind(query, db.dialect), args...)
}

func (db *DB) Query(query string, args ...any) (*sql.Rows, error) {
	return db.raw.Query(rebind(query, db.dialect), args...)
}

func (db *DB) QueryRow(query string, args ...any) *sql.Row {
	return db.raw.QueryRow(rebind(query, db.dialect), args...)
}

func (db *DB) Begin() (*Tx, error) {
	tx, err := db.raw.Begin()
	if err != nil {
		return nil, err
	}
	return &Tx{raw: tx, dialect: db.dialect}, nil
}

func (db *DB) Ping() error  { return db.raw.Ping() }
func (db *DB) Close() error { return db.raw.Close() }

func (tx *Tx) Exec(query string, args ...any) (sql.Result, error) {
	return tx.raw.Exec(rebind(query, tx.dialect), args...)
}

func (tx *Tx) QueryRow(query string, args ...any) *sql.Row {
	return tx.raw.QueryRow(rebind(query, tx.dialect), args...)
}

func (tx *Tx) Commit() error   { return tx.raw.Commit() }
func (tx *Tx) Rollback() error { return tx.raw.Rollback() }

// InitDB initializes PostgreSQL. The :memory: DSN is retained for isolated tests.
func InitDB(dsn string) *DB {
	driver, dialect := "sqlite3", "sqlite"
	if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
		driver, dialect = "pgx", "postgres"
	} else if dsn != ":memory:" && !strings.HasPrefix(dsn, "file:") {
		dsn += "?_busy_timeout=5000&_journal_mode=WAL&_synchronous=NORMAL"
	}

	raw, err := sql.Open(driver, dsn)
	if err != nil {
		log.Fatalf("Failed to open %s database: %v", dialect, err)
	}
	if dialect == "sqlite" {
		raw.SetMaxOpenConns(10)
	} else {
		raw.SetMaxOpenConns(20)
		raw.SetMaxIdleConns(5)
		raw.SetConnMaxLifetime(time.Hour)
	}

	db := &DB{raw: raw, dialect: dialect}
	if err := pingWithRetry(db, 30*time.Second); err != nil {
		log.Fatalf("Failed to connect to %s: %v", dialect, err)
	}

	for _, query := range schemaQueries(dialect) {
		if _, err := db.Exec(query); err != nil {
			log.Fatalf("Failed to execute schema query %q: %v", query, err)
		}
	}

	dbConn = db
	return db
}

func pingWithRetry(db *DB, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var lastErr error
	for {
		if lastErr = db.Ping(); lastErr == nil {
			return nil
		}
		if time.Now().After(deadline) {
			return lastErr
		}
		time.Sleep(time.Second)
	}
}

func schemaQueries(dialect string) []string {
	autoID := "BIGSERIAL PRIMARY KEY"
	if dialect == "sqlite" {
		autoID = "INTEGER PRIMARY KEY AUTOINCREMENT"
	}
	return []string{
		`CREATE TABLE IF NOT EXISTS users (
			username TEXT PRIMARY KEY,
			password_hash TEXT NOT NULL,
			salt TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS sessions (
			token TEXT PRIMARY KEY,
			username TEXT NOT NULL,
			expires_at BIGINT NOT NULL,
			is_guest BOOLEAN NOT NULL DEFAULT FALSE
		)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)`,
		`CREATE TABLE IF NOT EXISTS tracks (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			artist TEXT NOT NULL,
			audio_url TEXT NOT NULL,
			duration INTEGER NOT NULL,
			owner_username TEXT,
			is_public BOOLEAN NOT NULL DEFAULT FALSE,
			sources_json TEXT NOT NULL DEFAULT '[]'
		)`,
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS chats (
			id %s,
			room_id TEXT NOT NULL,
			username TEXT NOT NULL,
			text TEXT NOT NULL,
			timestamp BIGINT NOT NULL
		)`, autoID),
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS global_chat_messages (
			id %s,
			username TEXT NOT NULL,
			text TEXT NOT NULL,
			timestamp BIGINT NOT NULL
		)`, autoID),
		`CREATE INDEX IF NOT EXISTS idx_global_chat_messages_id ON global_chat_messages(id)`,
		`CREATE TABLE IF NOT EXISTS meditation_backgrounds (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			image_url TEXT NOT NULL,
			is_default BOOLEAN NOT NULL DEFAULT FALSE,
			uploaded_by TEXT
		)`,
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
			started_at BIGINT NOT NULL DEFAULT 0,
			password_hash BYTEA,
			updated_at BIGINT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS room_members (
			room_id TEXT NOT NULL,
			username TEXT NOT NULL,
			client_id TEXT NOT NULL,
			joined_at BIGINT NOT NULL,
			PRIMARY KEY (room_id, username, client_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_room_members_lookup ON room_members(room_id, username, client_id)`,
		`CREATE TABLE IF NOT EXISTS meditation_events (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			host_username TEXT NOT NULL,
			room_id TEXT NOT NULL UNIQUE,
			starts_at BIGINT NOT NULL,
			duration INTEGER NOT NULL,
			track_id TEXT,
			voice_track_id TEXT,
			background_id TEXT,
			created_at BIGINT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_meditation_events_starts_at ON meditation_events(starts_at)`,
		`CREATE TABLE IF NOT EXISTS meditation_event_attendees (
			event_id TEXT NOT NULL,
			username TEXT NOT NULL,
			created_at BIGINT NOT NULL,
			PRIMARY KEY (event_id, username),
			FOREIGN KEY (event_id) REFERENCES meditation_events(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS room_participations (
			room_id TEXT NOT NULL,
			username TEXT NOT NULL,
			was_host BOOLEAN NOT NULL DEFAULT FALSE,
			joined_at BIGINT NOT NULL,
			PRIMARY KEY (room_id, username)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_room_participations_username ON room_participations(username)`,
		`CREATE TABLE IF NOT EXISTS profile_likes (
			profile_username TEXT NOT NULL,
			liked_by TEXT NOT NULL,
			created_at BIGINT NOT NULL,
			PRIMARY KEY (profile_username, liked_by)
		)`,
		`CREATE TABLE IF NOT EXISTS user_ignores (
			ignoring_username TEXT NOT NULL,
			ignored_username TEXT NOT NULL,
			created_at BIGINT NOT NULL,
			PRIMARY KEY (ignoring_username, ignored_username)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_user_ignores_ignored ON user_ignores(ignored_username, ignoring_username)`,
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS direct_messages (
			id %s,
			sender_username TEXT NOT NULL,
			recipient_username TEXT NOT NULL,
			text TEXT NOT NULL,
			created_at BIGINT NOT NULL,
			read_at BIGINT
		)`, autoID),
		`CREATE INDEX IF NOT EXISTS idx_direct_messages_dialog ON direct_messages(sender_username, recipient_username, id)`,
		`CREATE INDEX IF NOT EXISTS idx_direct_messages_unread ON direct_messages(recipient_username, read_at, id)`,
	}
}

// MigrateJSONToDB imports data from the legacy JSON storage.
func MigrateJSONToDB(db *DB) {
	if _, err := os.Stat("users.json"); err == nil {
		var storedUsers map[string]StoredUser
		data, err := os.ReadFile("users.json")
		if err == nil && json.Unmarshal(data, &storedUsers) == nil {
			log.Printf("Migrating users from users.json...")
			tx, err := db.Begin()
			if err == nil {
				for _, user := range storedUsers {
					var exists bool
					err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE LOWER(username) = LOWER(?))", user.Username).Scan(&exists)
					if err == nil && !exists {
						_, _ = tx.Exec("INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)", user.Username, user.PasswordHash, user.Salt)
					}
				}
				_ = tx.Commit()
			}
			_ = os.Rename("users.json", "users.json.bak")
		}
	}

	if _, err := os.Stat("tracks.json"); err == nil {
		var tracks []Track
		data, err := os.ReadFile("tracks.json")
		if err == nil && json.Unmarshal(data, &tracks) == nil {
			log.Printf("Migrating tracks from tracks.json...")
			tx, err := db.Begin()
			if err == nil {
				for _, track := range tracks {
					var exists bool
					err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM tracks WHERE id = ?)", track.ID).Scan(&exists)
					if err == nil && !exists {
						_, _ = tx.Exec("INSERT INTO tracks (id, title, artist, audio_url, duration) VALUES (?, ?, ?, ?, ?)", track.ID, track.Title, track.Artist, track.AudioURL, track.Duration)
					}
				}
				_ = tx.Commit()
			}
			_ = os.Rename("tracks.json", "tracks.json.bak")
		}
	}

	if _, err := os.Stat("chat_history.json"); err == nil {
		var history map[string][]ChatMessage
		data, err := os.ReadFile("chat_history.json")
		if err == nil && json.Unmarshal(data, &history) == nil {
			log.Printf("Migrating chat history from chat_history.json...")
			tx, err := db.Begin()
			if err == nil {
				for roomID, messages := range history {
					for _, message := range messages {
						_, _ = tx.Exec("INSERT INTO chats (room_id, username, text, timestamp) VALUES (?, ?, ?, ?)", roomID, message.Username, message.Text, message.Timestamp)
					}
				}
				_ = tx.Commit()
			}
			_ = os.Rename("chat_history.json", "chat_history.json.bak")
		}
	}
}
