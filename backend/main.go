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

	if err := db.AutoMigrate(&model.User{}, &model.UserCredential{}, &model.Story{}, &model.StoryNode{}, &model.PlaySession{}, &model.LLMConnection{}, &model.PlatformLLMSetting{}, &model.UserStoryLLMConfig{}); err != nil {
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
	llmRepo := repository.NewLLMRepository(db)

	// Services
	agentClient := service.NewAgentClient(cfg.AgentURL)
	llmResolver := service.NewLLMResolver(llmRepo, cfg.EncryptionKey) // BYOK：按环节解析下发配置
	userSvc := service.NewUserService(userRepo, cfg.JWTSecret, cfg.EncryptionKey)
	storySvc := service.NewStoryService(storyRepo)
	nodeSvc := service.NewNodeService(nodeRepo)
	llmSvc := service.NewLLMService(llmRepo, agentClient, cfg.EncryptionKey)
	playSvc := service.NewPlayService(sessionRepo, nodeRepo, storyRepo, agentClient, llmResolver)

	// Handlers
	userH := handler.NewUserHandler(userSvc)
	storyH := handler.NewStoryHandler(storySvc)
	nodeH := handler.NewNodeHandler(nodeSvc)
	communityH := handler.NewCommunityHandler()
	playH := handler.NewPlayHandler(playSvc, guestID)
	assistH := handler.NewAssistHandler(agentClient, llmResolver)
	llmH := handler.NewLLMHandler(llmSvc)

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
		stories.GET("/mine", middleware.AuthRequired(cfg.JWTSecret), storyH.ListMine)
		stories.GET("/:id", storyH.Get)
		stories.PUT("/:id", middleware.AuthRequired(cfg.JWTSecret), storyH.Update)
		stories.PUT("/:id/status", middleware.AuthRequired(cfg.JWTSecret), storyH.SetStatus)
		stories.DELETE("/:id", middleware.AuthRequired(cfg.JWTSecret), storyH.Delete)
		stories.POST("/:id/nodes", middleware.AuthRequired(cfg.JWTSecret), nodeH.Create)
	}

	nodes := api.Group("/nodes")
	{
		nodes.GET("/:id/children", nodeH.GetChildren)
		nodes.PUT("/:id", middleware.AuthRequired(cfg.JWTSecret), nodeH.Update)
		nodes.DELETE("/:id", middleware.AuthRequired(cfg.JWTSecret), nodeH.Delete)
	}

	// 游玩：匿名可玩，但挂 AuthOptional——带 token 则归属登录用户，否则回退 guest。
	play := api.Group("/play", middleware.AuthOptional(cfg.JWTSecret))
	{
		play.POST("/sessions", playH.Start)
		play.POST("/sessions/migrate", middleware.AuthRequired(cfg.JWTSecret), playH.Migrate)
		play.POST("/sessions/:id/opening/stream", playH.OpeningStream)
		play.GET("/sessions", playH.List)
		play.GET("/sessions/:id", playH.Get)
		play.DELETE("/sessions/:id", playH.Delete)
		play.POST("/sessions/:id/choice/stream", playH.ChoiceStream)
		play.POST("/sessions/:id/backtrack", playH.Backtrack)
	}

	// 创作辅助：转发到 agent /assist/*（需登录；agent 无鉴权/CORS，前端不直连）。
	assist := api.Group("/assist", middleware.AuthRequired(cfg.JWTSecret))
	{
		assist.POST("/world", assistH.World)
		assist.POST("/opening", assistH.Opening)
		assist.POST("/polish", assistH.Polish)
		assist.POST("/branches", assistH.Branches)
	}

	// BYOK：用户 LLM 连接（CRUD + 测试）与环节绑定（需登录）。
	llm := api.Group("/llm", middleware.AuthRequired(cfg.JWTSecret))
	{
		llm.GET("/connections", llmH.ListConnections)
		llm.POST("/connections", llmH.CreateConnection)
		llm.PUT("/connections/:id", llmH.UpdateConnection)
		llm.DELETE("/connections/:id", llmH.DeleteConnection)
		llm.POST("/connections/test", llmH.TestConnection)
		llm.GET("/connections/:id/models", llmH.ListModels)        // 拉取该连接可用模型
		llm.GET("/story-config/:storyId", llmH.GetStoryConfig)     // 玩家在某作品的模型配置
		llm.PUT("/story-config/:storyId", llmH.SetStoryConfig)
	}

	// 平台 LLM 设置（仅管理员：AuthRequired + RequireAdmin）。第一个 admin 靠手动改库提权。
	adminLLM := api.Group("/admin/llm", middleware.AuthRequired(cfg.JWTSecret), middleware.RequireAdmin())
	{
		adminLLM.GET("/platform", llmH.ListPlatform)
		adminLLM.PUT("/platform", llmH.UpsertPlatform)
		adminLLM.POST("/platform/test", llmH.TestPlatform)
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
