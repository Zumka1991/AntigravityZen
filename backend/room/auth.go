package room

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"log"
	"strings"
	"time"
)

// StoredUser представляет данные пользователя для сохранения в БД
type StoredUser struct {
	Username     string `json:"username"`
	PasswordHash string `json:"password_hash"`
	Salt         string `json:"salt"`
	// IsBot is an internal flag that is NEVER serialized to the client.
	// Bots look exactly like human accounts in every public API surface.
	IsBot bool `json:"-"`
}

// AuthManager управляет сессиями и пользователями с помощью БД.
type AuthManager struct {
	db *DB
}

// NewAuthManager создает новый менеджер авторизации с использованием БД
func NewAuthManager(db *DB) *AuthManager {
	_, _ = db.Exec("DELETE FROM sessions WHERE expires_at <= ?", time.Now().Unix())
	return &AuthManager{
		db: db,
	}
}

const sessionLifetime = 30 * 24 * time.Hour

func (am *AuthManager) createSession(username string, isGuest bool) (string, error) {
	token := generateToken()
	expiresAt := time.Now().Add(sessionLifetime).Unix()
	if _, err := am.db.Exec(
		"INSERT INTO sessions (token, username, expires_at, is_guest) VALUES (?, ?, ?, ?)",
		token, username, expiresAt, isGuest,
	); err != nil {
		return "", err
	}
	return token, nil
}

// Register регистрирует нового пользователя и возвращает сессионный токен
func (am *AuthManager) Register(username, password string) (string, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return "", errors.New("username cannot be empty")
	}
	if strings.HasPrefix(strings.ToLower(username), "guest-") {
		return "", errors.New("this username is reserved")
	}
	if len(password) < 4 {
		return "", errors.New("password must be at least 4 characters long")
	}

	key := strings.ToLower(username)

	// Проверяем, существует ли пользователь (без учета регистра)
	var exists bool
	err := am.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE LOWER(username) = ?)", key).Scan(&exists)
	if err != nil {
		return "", err
	}
	if exists {
		return "", errors.New("username already taken")
	}

	salt := generateSalt()
	hash := hashPassword(password, salt)

	// Записываем в БД
	_, err = am.db.Exec("INSERT INTO users (username, password_hash, salt, is_bot) VALUES (?, ?, ?, FALSE)", username, hash, salt)
	if err != nil {
		return "", err
	}

	return am.createSession(username, false)
}

// IsUserBot reports whether the named account is a bot. Safe to call without
// the user existing - returns false in that case.
func (am *AuthManager) IsUserBot(username string) bool {
	if am == nil || am.db == nil || username == "" {
		return false
	}
	var isBot bool
	err := am.db.QueryRow("SELECT is_bot FROM users WHERE LOWER(username) = LOWER(?)", username).Scan(&isBot)
	return err == nil && isBot
}

// ListBotUsernames returns every bot account, ordered by username.
func (am *AuthManager) ListBotUsernames() ([]string, error) {
	if am == nil || am.db == nil {
		return nil, errors.New("auth manager is not initialized")
	}
	rows, err := am.db.Query("SELECT username FROM users WHERE is_bot = TRUE ORDER BY username")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	return names, rows.Err()
}

// CreateBotUser inserts a bot account if it doesn't exist yet. Each bot
// receives a long random password; only the generated session token (see
// EnsureBotSession) is used for outbound HTTP/WS calls.
func (am *AuthManager) CreateBotUser(username string) error {
	if am == nil || am.db == nil || username == "" {
		return errors.New("auth manager is not initialized")
	}
	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username cannot be empty")
	}
	var exists bool
	if err := am.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE LOWER(username) = LOWER(?))", username).Scan(&exists); err != nil {
		return err
	}
	if exists {
		// Promote to is_bot = TRUE in case the account existed without the flag.
		_, err := am.db.Exec("UPDATE users SET is_bot = TRUE WHERE LOWER(username) = LOWER(?)", username)
		return err
	}
	salt := generateSalt()
	password := generateToken() // random, never reused or stored as plaintext
	hash := hashPassword(password, salt)
	_, err := am.db.Exec("INSERT INTO users (username, password_hash, salt, is_bot) VALUES (?, ?, ?, TRUE)", username, hash, salt)
	return err
}

// EnsureBotSession returns a fresh, long-lived session token for the given
// bot. New tokens are stored on each call; old tokens naturally expire after
// sessionLifetime. We never expose bot tokens to a UI; they live only in the
// in-memory BotManager.
func (am *AuthManager) EnsureBotSession(username string) (string, error) {
	if am == nil || am.db == nil || username == "" {
		return "", errors.New("auth manager is not initialized")
	}
	token := generateToken()
	expiresAt := time.Now().Add(sessionLifetime).Unix()
	if _, err := am.db.Exec(
		"INSERT INTO sessions (token, username, expires_at, is_guest) VALUES (?, ?, ?, FALSE)",
		token, username, expiresAt,
	); err != nil {
		return "", err
	}
	return token, nil
}

// BotLastHostedAt returns the unix-millisecond timestamp of the bot's last
// hosted meditation, or 0 if the bot hasn't hosted one yet.
func (am *AuthManager) BotLastHostedAt(username string) (int64, error) {
	if am == nil || am.db == nil || username == "" {
		return 0, errors.New("auth manager is not initialized")
	}
	var ts int64
	err := am.db.QueryRow(
		"SELECT last_hosted_at FROM users WHERE LOWER(username) = LOWER(?)",
		username,
	).Scan(&ts)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return ts, err
}

// MarkBotHosted stamps the bot's last_hosted_at to the supplied unix-ms value.
func (am *AuthManager) MarkBotHosted(username string, ts int64) error {
	if am == nil || am.db == nil || username == "" {
		return errors.New("auth manager is not initialized")
	}
	_, err := am.db.Exec(
		"UPDATE users SET last_hosted_at = ? WHERE LOWER(username) = LOWER(?)",
		ts, username,
	)
	return err
}

// Login аутентифицирует пользователя и возвращает сессионный токен
func (am *AuthManager) Login(username, password string) (string, error) {
	username = strings.TrimSpace(username)
	key := strings.ToLower(username)

	var dbUsername string
	var passwordHash string
	var salt string

	err := am.db.QueryRow("SELECT username, password_hash, salt FROM users WHERE LOWER(username) = ?", key).
		Scan(&dbUsername, &passwordHash, &salt)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", errors.New("invalid username or password")
		}
		return "", err
	}

	hash := hashPassword(password, salt)
	if hash != passwordHash {
		return "", errors.New("invalid username or password")
	}

	return am.createSession(dbUsername, false)
}

// CreateGuest creates a durable anonymous session with a collision-resistant nickname.
func (am *AuthManager) CreateGuest() (string, string, error) {
	for attempt := 0; attempt < 10; attempt++ {
		suffixBytes := make([]byte, 3)
		if _, err := rand.Read(suffixBytes); err != nil {
			return "", "", err
		}
		username := "Guest-" + strings.ToUpper(hex.EncodeToString(suffixBytes))

		var exists bool
		err := am.db.QueryRow(`
			SELECT EXISTS(
				SELECT 1 FROM users WHERE LOWER(username) = LOWER(?)
				UNION ALL
				SELECT 1 FROM sessions
				WHERE LOWER(username) = LOWER(?) AND expires_at > ?
			)
		`, username, username, time.Now().Unix()).Scan(&exists)
		if err != nil {
			return "", "", err
		}
		if exists {
			continue
		}

		token, err := am.createSession(username, true)
		return username, token, err
	}
	return "", "", errors.New("could not create unique guest")
}

// ValidateSession returns the identity and whether it belongs to a guest.
func (am *AuthManager) ValidateSession(token string) (string, bool, bool) {
	if token == "" {
		return "", false, false
	}
	var username string
	var expiresAt int64
	var isGuest bool
	err := am.db.QueryRow(
		"SELECT username, expires_at, is_guest FROM sessions WHERE token = ?",
		token,
	).Scan(&username, &expiresAt, &isGuest)
	if err != nil || expiresAt <= time.Now().Unix() {
		if err == nil {
			_, _ = am.db.Exec("DELETE FROM sessions WHERE token = ?", token)
		}
		return "", false, false
	}
	return username, isGuest, true
}

// ValidateToken проверяет валидность токена и возвращает имя пользователя
func (am *AuthManager) ValidateToken(token string) (string, bool) {
	username, _, valid := am.ValidateSession(token)
	return username, valid
}

// Logout удаляет активную сессию
func (am *AuthManager) Logout(token string) {
	if token == "" {
		return
	}
	_, _ = am.db.Exec("DELETE FROM sessions WHERE token = ?", token)
}

// EnsureAdminCreated ensures that the configured admin account exists with the
// given password. The admin's username is configurable via the
// ADMIN_USERNAME env var (default: "admin"). The password comes from the
// ADMIN_PASSWORD env var. The flag runs only on first deploy; existing admin
// accounts keep working unchanged.
func (am *AuthManager) EnsureAdminCreated(adminUsername, defaultPassword string) {
	if adminUsername == "" {
		adminUsername = "admin"
	}
	if defaultPassword == "" {
		log.Println("Admin password is empty; skipping admin bootstrap")
		return
	}
	var exists bool
	err := am.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE LOWER(username) = LOWER(?))", adminUsername).Scan(&exists)
	if err != nil {
		log.Printf("Error checking if admin user exists: %v", err)
		return
	}
	if exists {
		log.Printf("Admin user %q already exists", adminUsername)
		return
	}

	salt := generateSalt()
	hash := hashPassword(defaultPassword, salt)

	_, err = am.db.Exec(
		"INSERT INTO users (username, password_hash, salt, is_bot) VALUES (?, ?, ?, FALSE)",
		adminUsername, hash, salt,
	)
	if err != nil {
		log.Printf("Error creating default admin user: %v", err)
	} else {
		log.Printf("Default admin user %q created successfully", adminUsername)
	}
}

// Вспомогательные функции для криптографии

func generateSalt() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "default_salt_zen_space"
	}
	return hex.EncodeToString(b)
}

func generateToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "fallback_token_" + generateSalt()
	}
	return hex.EncodeToString(b)
}

func hashPassword(password string, salt string) string {
	hasher := sha256.New()
	hasher.Write([]byte(password + salt))
	return hex.EncodeToString(hasher.Sum(nil))
}
