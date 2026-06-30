package room

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"log"
	"strings"
	"sync"
)

// StoredUser представляет данные пользователя для сохранения в БД
type StoredUser struct {
	Username     string `json:"username"`
	PasswordHash string `json:"password_hash"`
	Salt         string `json:"salt"`
}

// AuthManager управляет сессиями и пользователями с помощью SQLite
type AuthManager struct {
	db       *sql.DB
	sessions map[string]string // token -> username
	mu       sync.RWMutex
}

// NewAuthManager создает новый менеджер авторизации с использованием БД
func NewAuthManager(db *sql.DB) *AuthManager {
	return &AuthManager{
		db:       db,
		sessions: make(map[string]string),
	}
}

// Register регистрирует нового пользователя и возвращает сессионный токен
func (am *AuthManager) Register(username, password string) (string, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return "", errors.New("username cannot be empty")
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
	_, err = am.db.Exec("INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)", username, hash, salt)
	if err != nil {
		return "", err
	}

	token := generateToken()
	am.mu.Lock()
	am.sessions[token] = username
	am.mu.Unlock()

	return token, nil
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

	token := generateToken()
	am.mu.Lock()
	am.sessions[token] = dbUsername
	am.mu.Unlock()

	return token, nil
}

// ValidateToken проверяет валидность токена и возвращает имя пользователя
func (am *AuthManager) ValidateToken(token string) (string, bool) {
	if token == "" {
		return "", false
	}
	am.mu.RLock()
	defer am.mu.RUnlock()

	username, exists := am.sessions[token]
	return username, exists
}

// Logout удаляет активную сессию
func (am *AuthManager) Logout(token string) {
	if token == "" {
		return
	}
	am.mu.Lock()
	defer am.mu.Unlock()
	delete(am.sessions, token)
}

// EnsureAdminCreated проверяет наличие пользователя admin и создает его с паролем по умолчанию, если его нет
func (am *AuthManager) EnsureAdminCreated(defaultPassword string) {
	var exists bool
	err := am.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE LOWER(username) = 'admin')").Scan(&exists)
	if err != nil {
		log.Printf("Error checking if admin user exists: %v", err)
		return
	}
	if exists {
		return
	}

	salt := generateSalt()
	hash := hashPassword(defaultPassword, salt)

	_, err = am.db.Exec("INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)", "admin", hash, salt)
	if err != nil {
		log.Printf("Error creating default admin user: %v", err)
	} else {
		log.Println("Default admin user created successfully")
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
