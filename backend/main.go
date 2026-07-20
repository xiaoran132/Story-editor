package main

import (
	"fmt"
	"log"

	"backend/config"
	"backend/internal/handler"
	"backend/internal/middleware"
	"backend/internal/model"
	"backend/internal/repository"
	"backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func main() {
	cfg, err := config.Load("")
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	db, err := gorm.Open(postgres.Open(cfg.DSN()), &gorm.Config{})
	if err != nil {
		log.Fatalf("failed to connect database: %v", err)
	}

	// 先启用 pgcrypto 扩展
	db.Exec("CREATE EXTENSION IF NOT EXISTS pgcrypto")

	if err := db.AutoMigrate(&model.User{}, &model.UserCredential{}, &model.Story{}, &model.StoryNode{}, &model.PlaySession{}); err != nil {
		log.Fatalf("failed to migrate: %v", err)
	}

	// 预置 guest 用户 + demo 作品（幂等）
	guestID, err := seed(db)
	if err != nil {
		log.Fatalf("failed to seed: %v", err)
	}

	// Repositories
	userRepo := repository.NewUserRepository(db)
	storyRepo := repository.NewStoryRepository(db)
	nodeRepo := repository.NewNodeRepository(db)
	sessionRepo := repository.NewPlaySessionRepository(db)

	// Services
	userSvc := service.NewUserService(userRepo, cfg.JWTSecret)
	storySvc := service.NewStoryService(storyRepo)
	nodeSvc := service.NewNodeService(nodeRepo)
	aiClient := service.NewAIClient(cfg.AIServiceURL)
	playSvc := service.NewPlayService(sessionRepo, nodeRepo, storyRepo, aiClient)

	// Handlers
	userH := handler.NewUserHandler(userSvc)
	storyH := handler.NewStoryHandler(storySvc)
	nodeH := handler.NewNodeHandler(nodeSvc)
	communityH := handler.NewCommunityHandler()
	playH := handler.NewPlayHandler(playSvc, guestID)

	r := gin.Default()
	r.Use(middleware.CORS())
	r.LoadHTMLGlob("../templates/*")

	// 最小游玩界面
	r.GET("/", func(c *gin.Context) {
		c.HTML(200, "index.html", gin.H{"title": "AI 互动剧情"})
	})

	api := r.Group("/api/v1")
	auth := api.Group("/auth")
	{
		auth.POST("/register", userH.Register)
		auth.POST("/login", userH.Login)
		auth.GET("/profile", middleware.AuthRequired(cfg.JWTSecret), userH.GetProfile)
		auth.PUT("/profile", middleware.AuthRequired(cfg.JWTSecret), userH.UpdateProfile)
	}

	stories := api.Group("/stories")
	{
		stories.POST("/", middleware.AuthRequired(cfg.JWTSecret), storyH.Create)
		stories.GET("/", storyH.List)
		stories.GET("/:id", storyH.Get)
		stories.PUT("/:id", middleware.AuthRequired(cfg.JWTSecret), storyH.Update)
		stories.DELETE("/:id", middleware.AuthRequired(cfg.JWTSecret), storyH.Delete)
		stories.POST("/:id/nodes", middleware.AuthRequired(cfg.JWTSecret), nodeH.Create)
	}

	nodes := api.Group("/nodes")
	{
		nodes.GET("/:id/children", nodeH.GetChildren)
		nodes.PUT("/:id", middleware.AuthRequired(cfg.JWTSecret), nodeH.Update)
		nodes.DELETE("/:id", middleware.AuthRequired(cfg.JWTSecret), nodeH.Delete)
	}

	// 游玩：匿名可玩（不挂 AuthRequired；登录用户仍会被 GetUserID 解析）
	play := api.Group("/play")
	{
		play.POST("/sessions", playH.Start)
		play.GET("/sessions/:id", playH.Get)
		play.POST("/sessions/:id/choice", playH.Choice)
		play.POST("/sessions/:id/backtrack", playH.Backtrack)
	}

	community := api.Group("/community")
	{
		community.GET("/stories", communityH.ListStories)
		community.GET("/stories/:id", communityH.GetStoryDetail)
		community.POST("/stories/:id/like", middleware.AuthRequired(cfg.JWTSecret), communityH.Like)
		community.POST("/stories/:id/comments", middleware.AuthRequired(cfg.JWTSecret), communityH.Comment)
	}

	addr := cfg.ServerPort
	fmt.Printf("Server starting on %s\n", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("failed to start server: %v", err)
	}
}
