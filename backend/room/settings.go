package room

import (
	"errors"
	"strconv"
	"strings"
	"time"
)

// Setting keys used across the application. Stored in app_settings table.
const (
	SettingBotsEnabled       = "bots_enabled"
	SettingBotsMaxConcurrent = "bots_max_concurrent"
)

// SettingValue returns the raw string value of a setting, or "" when the key
// is unset. Errors are intentionally swallowed: callers get a sensible default.
func SettingValue(key string) string {
	if dbConn == nil || key == "" {
		return ""
	}
	var value string
	if err := dbConn.QueryRow("SELECT value FROM app_settings WHERE key = ?", key).Scan(&value); err != nil {
		return ""
	}
	return value
}

// SettingBool returns the boolean interpretation of a setting. Falls back to
// fallbackVal when unset or unparsable.
func SettingBool(key string, fallbackVal bool) bool {
	raw := strings.ToLower(strings.TrimSpace(SettingValue(key)))
	if raw == "" {
		return fallbackVal
	}
	switch raw {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	}
	return fallbackVal
}

// SettingInt returns the int interpretation of a setting. Falls back to
// fallbackVal when unset or unparsable.
func SettingInt(key string, fallbackVal int) int {
	raw := strings.TrimSpace(SettingValue(key))
	if raw == "" {
		return fallbackVal
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return fallbackVal
	}
	return n
}

// SetSetting writes the given key/value pair with the current timestamp. It is
// idempotent and safe to call from any goroutine.
func SetSetting(key, value string) error {
	if dbConn == nil || key == "" {
		return errors.New("database is not initialized")
	}
	_, err := dbConn.Exec(
		`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		key, value, time.Now().UnixMilli(),
	)
	return err
}

// InitSettings seeds the default app_settings rows on a fresh database.
// Safe to call repeatedly; INSERT OR IGNORE in sqlite, ON CONFLICT DO NOTHING
// covers both dialects when re-bind converts ? to $N.
func InitSettings() {
	if dbConn == nil {
		return
	}
	defaults := map[string]string{
		SettingBotsEnabled:       "false",
		SettingBotsMaxConcurrent: "5",
	}
	for k, v := range defaults {
		// Use raw.Exec for INSERT ... ON CONFLICT DO NOTHING which works in
		// both sqlite (>= 3.24) and postgres without dialect-specific syntax.
		_, _ = dbConn.raw.Exec(
			rebind(
				`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
				 ON CONFLICT(key) DO NOTHING`,
				dbConn.dialect,
			),
			k, v, time.Now().UnixMilli(),
		)
	}
}
