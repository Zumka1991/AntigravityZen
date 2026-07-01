package main

import (
	"log"
	"os"

	"meditation-app/handlers"
	"meditation-app/room"

	"github.com/gin-gonic/gin"
)

func main() {
	db := room.InitDB("meditation.db")
	room.MigrateJSONToDB(db)
	room.InitTracks()
	room.InitChat()
	room.InitBackgrounds()
	os.MkdirAll("./uploads/recordings", 0755)

	hub := room.NewHub()
	if err := hub.LoadPersistentRooms(); err != nil {
		log.Printf("Could not restore rooms: %v", err)
	}
	go hub.Run()

	authManager := room.NewAuthManager(db)
	adminPassword := os.Getenv("ADMIN_PASSWORD")
	if adminPassword == "" {
		log.Fatal("ADMIN_PASSWORD environment variable is required")
	}
	authManager.EnsureAdminCreated(adminPassword)

	// Set Gin mode
	ginMode := os.Getenv("GIN_MODE")
	if ginMode == "" {
		ginMode = gin.ReleaseMode
	}
	gin.SetMode(ginMode)

	r := gin.Default()

	// CORS Middleware
	r.Use(corsMiddleware())

	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Static files serving for uploads
	r.Static("/uploads", "./uploads")

	// API Routes
	r.POST("/api/register", handlers.RegisterHandler(authManager))
	r.POST("/api/login", handlers.LoginHandler(authManager))
	r.POST("/api/guest", handlers.GuestHandler(authManager))
	r.POST("/api/verify", handlers.VerifyHandler(authManager))
	r.POST("/api/logout", handlers.LogoutHandler(authManager))
	r.GET("/api/profiles", handlers.ListProfilesHandler(authManager))
	r.GET("/api/profiles/:username", handlers.GetProfileHandler(authManager))
	r.POST("/api/profiles/:username/like", handlers.SetProfileLikeHandler(authManager))
	r.GET("/api/messages", handlers.ListConversationsHandler(authManager))
	r.GET("/api/messages/:username", handlers.ListDirectMessagesHandler(authManager))
	r.POST("/api/messages/:username", handlers.SendDirectMessageHandler(authManager))
	r.GET("/api/notifications", handlers.DirectMessageNotificationsHandler(authManager))

	r.GET("/api/rooms", handlers.GetRoomsHandler(hub))
	r.POST("/api/rooms/access", handlers.RoomAccessHandler(hub, authManager))
	r.GET("/api/events", handlers.GetMeditationEventsHandler(hub, authManager))
	r.POST("/api/events", handlers.CreateMeditationEventHandler(authManager))
	r.POST("/api/events/:id/attendance", handlers.SetMeditationEventAttendanceHandler(authManager))
	r.DELETE("/api/events/:id", handlers.DeleteMeditationEventHandler(authManager))

	r.GET("/api/tracks", handlers.GetTracksHandler(authManager))
	r.POST("/api/tracks", handlers.AddTrackHandler(authManager))
	r.DELETE("/api/tracks", handlers.DeleteTrackHandler(authManager))
	r.GET("/api/global-chat", handlers.GetGlobalChatHandler(authManager))
	r.POST("/api/global-chat", handlers.AddGlobalChatMessageHandler(authManager))
	r.GET("/api/backgrounds", handlers.GetBackgroundsHandler(authManager))
	r.POST("/api/backgrounds", handlers.AddBackgroundHandler(authManager))
	r.DELETE("/api/backgrounds", handlers.DeleteBackgroundHandler(authManager))

	// WebSocket Route
	r.GET("/ws", handlers.WSHandler(hub, authManager))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("Server started on :%s", port)
	if err := r.Run(":" + port); err != nil {
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
