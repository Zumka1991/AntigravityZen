package main

import (
	"log"
	"os"

	"meditation-app/handlers"
	"meditation-app/room"

	"github.com/gin-gonic/gin"
)

func main() {
	hub := room.NewHub()
	go hub.Run()

	db := room.InitDB("meditation.db")
	room.MigrateJSONToDB(db)
	room.InitTracks()
	room.InitChat()
	os.MkdirAll("./uploads/recordings", 0755)

	authManager := room.NewAuthManager(db)
	authManager.EnsureAdminCreated("Pifagor1991GG")

	// Set Gin mode
	gin.SetMode(gin.DebugMode)

	r := gin.Default()

	// CORS Middleware
	r.Use(corsMiddleware())

	// Static files serving for uploads
	r.Static("/uploads", "./uploads")

	// API Routes
	r.POST("/api/register", handlers.RegisterHandler(authManager))
	r.POST("/api/login", handlers.LoginHandler(authManager))
	r.POST("/api/verify", handlers.VerifyHandler(authManager))

	r.GET("/api/rooms", handlers.GetRoomsHandler(hub))

	r.GET("/api/tracks", handlers.GetTracksHandler(authManager))
	r.POST("/api/tracks", handlers.AddTrackHandler(authManager))
	r.DELETE("/api/tracks", handlers.DeleteTrackHandler(authManager))
	r.GET("/api/global-chat", handlers.GetGlobalChatHandler(authManager))
	r.POST("/api/global-chat", handlers.AddGlobalChatMessageHandler(authManager))

	// WebSocket Route
	r.GET("/ws", handlers.WSHandler(hub, authManager))

	log.Println("Server started on :8080")
	if err := r.Run(":8080"); err != nil {
		log.Fatalf("Failed to run server: %v", err)
	}
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(200)
			return
		}

		c.Next()
	}
}
