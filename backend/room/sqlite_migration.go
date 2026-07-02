package room

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"
)

type sqliteTable struct {
	name        string
	columns     []string
	boolColumns map[int]bool
	defaults    map[string]string
	sourceWhere string
}

// MigrateSQLiteFile imports the previous production database once. The source
// file is renamed only after every table has committed successfully.
func MigrateSQLiteFile(target *DB, path string) error {
	if target.dialect != "postgres" {
		return nil
	}
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	source, err := sql.Open("sqlite3", "file:"+path+"?mode=ro")
	if err != nil {
		return fmt.Errorf("open legacy SQLite database: %w", err)
	}
	defer source.Close()
	if err := source.Ping(); err != nil {
		return fmt.Errorf("read legacy SQLite database: %w", err)
	}

	tables := []sqliteTable{
		{name: "users", columns: []string{"username", "password_hash", "salt"}},
		{name: "sessions", columns: []string{"token", "username", "expires_at", "is_guest"}, boolColumns: map[int]bool{3: true}, defaults: map[string]string{"is_guest": "0"}},
		{name: "tracks", columns: []string{"id", "title", "artist", "audio_url", "duration", "owner_username", "is_public", "sources_json"}, boolColumns: map[int]bool{6: true}, defaults: map[string]string{"owner_username": "NULL", "is_public": "0", "sources_json": "'[]'"}},
		{name: "chats", columns: []string{"id", "room_id", "username", "text", "timestamp"}},
		{name: "global_chat_messages", columns: []string{"id", "username", "text", "timestamp"}},
		{name: "meditation_backgrounds", columns: []string{"id", "title", "image_url", "is_default", "uploaded_by"}, boolColumns: map[int]bool{3: true}},
		{name: "rooms", columns: []string{"id", "name", "host_id", "host_username", "status", "active_track_id", "voice_track_id", "background_id", "duration", "started_at", "password_hash", "updated_at"}},
		{name: "room_members", columns: []string{"room_id", "username", "client_id", "joined_at"}},
		{name: "meditation_events", columns: []string{"id", "title", "description", "host_username", "room_id", "starts_at", "duration", "track_id", "voice_track_id", "background_id", "created_at"}},
		{
			name:        "meditation_event_attendees",
			columns:     []string{"event_id", "username", "created_at"},
			sourceWhere: "WHERE event_id IN (SELECT id FROM meditation_events)",
		},
		{name: "room_participations", columns: []string{"room_id", "username", "was_host", "joined_at"}, boolColumns: map[int]bool{2: true}},
		{name: "profile_likes", columns: []string{"profile_username", "liked_by", "created_at"}},
		{name: "direct_messages", columns: []string{"id", "sender_username", "recipient_username", "text", "created_at", "read_at"}},
	}

	tx, err := target.Begin()
	if err != nil {
		return fmt.Errorf("begin SQLite migration: %w", err)
	}
	defer tx.Rollback()

	for _, table := range tables {
		exists, err := sqliteTableExists(source, table.name)
		if err != nil {
			return err
		}
		if !exists {
			continue
		}
		count, err := copySQLiteTable(source, tx, table)
		if err != nil {
			return err
		}
		log.Printf("Migrated %d rows from SQLite table %s", count, table.name)
	}

	for _, table := range []string{"chats", "global_chat_messages", "direct_messages"} {
		query := fmt.Sprintf(
			"SELECT setval(pg_get_serial_sequence('%s', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM %s",
			table, table,
		)
		if _, err := tx.Exec(query); err != nil {
			return fmt.Errorf("reset %s sequence: %w", table, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit SQLite migration: %w", err)
	}
	if err := source.Close(); err != nil {
		return fmt.Errorf("close legacy SQLite database: %w", err)
	}
	migratedPath := path + ".migrated"
	if err := os.Rename(path, migratedPath); err != nil {
		return fmt.Errorf("mark SQLite migration complete: %w", err)
	}
	for _, suffix := range []string{"-wal", "-shm"} {
		if _, err := os.Stat(path + suffix); err == nil {
			if err := os.Rename(path+suffix, migratedPath+suffix); err != nil {
				log.Printf("Could not rename SQLite sidecar %s: %v", path+suffix, err)
			}
		}
	}
	log.Printf("Legacy SQLite database migrated to PostgreSQL and renamed to %s", migratedPath)
	return nil
}

func sqliteTableExists(db *sql.DB, table string) (bool, error) {
	var exists bool
	err := db.QueryRow(
		"SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?)",
		table,
	).Scan(&exists)
	return exists, err
}

func copySQLiteTable(source *sql.DB, target *Tx, table sqliteTable) (int, error) {
	columnList := strings.Join(table.columns, ", ")
	sourceColumns, err := sqliteColumns(source, table.name)
	if err != nil {
		return 0, err
	}
	selectColumns := make([]string, 0, len(table.columns))
	for _, column := range table.columns {
		if sourceColumns[column] {
			selectColumns = append(selectColumns, column)
			continue
		}
		defaultExpression, ok := table.defaults[column]
		if !ok {
			return 0, fmt.Errorf("legacy SQLite table %s is missing required column %s", table.name, column)
		}
		selectColumns = append(selectColumns, defaultExpression+" AS "+column)
	}
	query := "SELECT " + strings.Join(selectColumns, ", ") + " FROM " + table.name
	if table.sourceWhere != "" {
		query += " " + table.sourceWhere
	}
	rows, err := source.Query(query)
	if err != nil {
		return 0, fmt.Errorf("read SQLite table %s: %w", table.name, err)
	}
	defer rows.Close()

	placeholders := strings.TrimSuffix(strings.Repeat("?, ", len(table.columns)), ", ")
	insert := "INSERT INTO " + table.name + " (" + columnList + ") VALUES (" + placeholders + ") ON CONFLICT DO NOTHING"
	count := 0
	for rows.Next() {
		values := make([]any, len(table.columns))
		destinations := make([]any, len(values))
		for i := range values {
			destinations[i] = &values[i]
		}
		if err := rows.Scan(destinations...); err != nil {
			return count, fmt.Errorf("scan SQLite table %s: %w", table.name, err)
		}
		for index := range table.boolColumns {
			if values[index] == nil {
				values[index] = false
				continue
			}
			switch value := values[index].(type) {
			case int64:
				values[index] = value != 0
			case bool:
				values[index] = value
			default:
				return count, fmt.Errorf("unexpected boolean value %T in %s", value, table.name)
			}
		}
		if _, err := target.Exec(insert, values...); err != nil {
			return count, fmt.Errorf("write PostgreSQL table %s: %w", table.name, err)
		}
		count++
	}
	return count, rows.Err()
}

func sqliteColumns(db *sql.DB, table string) (map[string]bool, error) {
	rows, err := db.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return nil, fmt.Errorf("inspect SQLite table %s: %w", table, err)
	}
	defer rows.Close()
	columns := make(map[string]bool)
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, dataType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &primaryKey); err != nil {
			return nil, err
		}
		columns[name] = true
	}
	return columns, rows.Err()
}
