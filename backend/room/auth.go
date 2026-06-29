package room

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"os"
	"strings"
	"sync"
)

// StoredUser представляет данные пользователя для сохранения в БД
type StoredUser struct {
	Username     string `json:"username"`
	PasswordHash string `json:"password_hash"`
	Salt         string `json:"salt"`
}

// AuthManager управляет сессиями и пользователями
type AuthManager struct {
	usersFile string
	users     map[string]StoredUser
	sessions  map[string]string // token -> username
	mu        sync.RWMutex
}

// NewAuthManager создает новый менеджер авторизации
func NewAuthManager(usersFile string) *AuthManager {
	am := &AuthManager{
		usersFile: usersFile,
		users:     make(map[string]StoredUser),
		sessions:  make(map[string]string),
	}
	if err := am.loadUsers(); err != nil {
		log.Printf("Warning: failed to load users: %v", err)
	}
	return am
}

// LoadUsers считывает пользователей из JSON-файла
func (am *AuthManager) loadUsers() error {
	am.mu.Lock()
	defer am.mu.Unlock()

	data, err := os.ReadFile(am.usersFile)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // Файл еще не создан — это нормально
		}
		return err
	}

	return json.Unmarshal(data, &am.users)
}

// SaveUsers сохраняет пользователей в JSON-файл
func (am *AuthManager) saveUsers() error {
	data, err := json.MarshalIndent(am.users, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(am.usersFile, data, 0644)
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

	am.mu.Lock()
	defer am.mu.Unlock()

	if _, exists := am.users[key]; exists {
		return "", errors.New("username already taken")
	}

	salt := generateSalt()
	hash := hashPassword(password, salt)

	am.users[key] = StoredUser{
		Username:     username,
		PasswordHash: hash,
		Salt:         salt,
	}

	if err := am.saveUsers(); err != nil {
		return "", err
	}

	token := generateToken()
	am.sessions[token] = username

	return token, nil
}

// Login аутентифицирует пользователя и возвращает сессионный токен
func (am *AuthManager) Login(username, password string) (string, error) {
	username = strings.TrimSpace(username)
	key := strings.ToLower(username)

	am.mu.Lock()
	defer am.mu.Unlock()

	user, exists := am.users[key]
	if !exists {
		return "", errors.New("invalid username or password")
	}

	hash := hashPassword(password, user.Salt)
	if hash != user.PasswordHash {
		return "", errors.New("invalid username or password")
	}

	token := generateToken()
	am.sessions[token] = user.Username

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
	key := "admin"

	am.mu.Lock()
	defer am.mu.Unlock()

	if _, exists := am.users[key]; exists {
		return
	}

	salt := generateSalt()
	hash := hashPassword(defaultPassword, salt)

	am.users[key] = StoredUser{
		Username:     "admin",
		PasswordHash: hash,
		Salt:         salt,
	}

	if err := am.saveUsers(); err != nil {
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
