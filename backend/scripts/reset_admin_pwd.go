// One-off helper to reset the admin user's password in the local PG database
// using the same SHA-256 hashing the backend uses.
//
// Usage:
//   DATABASE_URL=postgres://meditation:meditation@127.0.0.1:5432/meditation?sslmode=disable \
//     go run ./scripts/reset_admin_pwd.go <username> <new_password>
package main

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"
	"strings"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: reset_admin_pwd <username> <new_password>")
		os.Exit(2)
	}
	username := strings.TrimSpace(os.Args[1])
	password := os.Args[2]
	if username == "" || password == "" {
		fmt.Fprintln(os.Stderr, "username and password cannot be empty")
		os.Exit(2)
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://meditation:meditation@localhost:5432/meditation?sslmode=disable"
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		fmt.Fprintf(os.Stderr, "open: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		fmt.Fprintf(os.Stderr, "ping: %v\n", err)
		os.Exit(1)
	}

	saltBytes := make([]byte, 16)
	if _, err := rand.Read(saltBytes); err != nil {
		fmt.Fprintf(os.Stderr, "salt: %v\n", err)
		os.Exit(1)
	}
	salt := hex.EncodeToString(saltBytes)
	hash := sha256.Sum256([]byte(password + salt))
	hashHex := hex.EncodeToString(hash[:])

	res, err := db.Exec(
		`UPDATE users
		 SET password_hash = $1, salt = $2
		 WHERE LOWER(username) = LOWER($3)`,
		hashHex, salt, username,
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "update: %v\n", err)
		os.Exit(1)
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		fmt.Fprintf(os.Stderr, "user %q not found — nothing updated\n", username)
		os.Exit(3)
	}
	fmt.Printf("Reset password for user %q (rows=%d)\n", username, affected)
}
