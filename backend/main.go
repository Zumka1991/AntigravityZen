package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"meditation-app/handlers"
	"meditation-app/room"

	"github.com/gin-gonic/gin"
)

func main() {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgres://meditation:meditation@localhost:5432/meditation?sslmode=disable"
	}
	db := room.InitDB(databaseURL)
	if err := room.MigrateSQLiteFile(db, "meditation.db"); err != nil {
		log.Fatalf("Could not migrate legacy SQLite database: %v", err)
	}
	room.MigrateJSONToDB(db)
	room.InitSettings()
	room.InitTracks()
	room.InitChat()
	room.InitBackgrounds()
	os.MkdirAll("./uploads/recordings", 0755)

	hub := room.NewHub()
	if err := hub.LoadPersistentRooms(); err != nil {
		log.Printf("Could not restore rooms: %v", err)
	}
	go hub.Run()
	if deleted, err := hub.PruneAbandonedMeditationEvents(time.Now()); err != nil {
		log.Printf("Could not prune abandoned meditation events: %v", err)
	} else if deleted > 0 {
		log.Printf("Removed %d abandoned meditation events", deleted)
	}
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for now := range ticker.C {
			if deleted, err := hub.PruneAbandonedMeditationEvents(now); err != nil {
				log.Printf("Could not prune abandoned meditation events: %v", err)
			} else if deleted > 0 {
				log.Printf("Removed %d abandoned meditation events", deleted)
			}
		}
	}()

	authManager := room.NewAuthManager(db)
	adminPassword := os.Getenv("ADMIN_PASSWORD")
	if adminPassword == "" {
		log.Fatal("ADMIN_PASSWORD environment variable is required")
	}
	adminUsername := os.Getenv("ADMIN_USERNAME")
	if adminUsername == "" {
		adminUsername = "admin"
	}
	authManager.EnsureAdminCreated(adminUsername, adminPassword)

	botManager := room.NewBotManager(authManager, hub)
	schedulerCtx, stopScheduler := context.WithCancel(context.Background())
	defer stopScheduler()
	botManager.Start(schedulerCtx)
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("Shutting down bot scheduler")
		stopScheduler()
		botManager.Stop()
	}()

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
		if err := db.Ping(); err != nil {
			c.JSON(503, gin.H{"status": "unhealthy", "database": "unavailable"})
			return
		}
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
	r.POST("/api/profiles/:username/ignore", handlers.SetUserIgnoredHandler(authManager))
	r.GET("/api/messages", handlers.ListConversationsHandler(authManager))
	r.GET("/api/messages/:username", handlers.ListDirectMessagesHandler(authManager))
	r.POST("/api/messages/:username", handlers.SendDirectMessageHandler(authManager))
	r.DELETE("/api/messages/:id", handlers.DeleteDirectMessageHandler(authManager))
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

	// Admin-only bot management. Usernames equal to ADMIN_USERNAME (default:
	// "admin") can read and flip the bot toggles. Tokens are validated like
	// every other authenticated request.
	r.GET("/api/admin/bots", handlers.GetBotSettingsHandler(authManager, botManager))
	r.PUT("/api/admin/bots", handlers.UpdateBotSettingsHandler(authManager))

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
