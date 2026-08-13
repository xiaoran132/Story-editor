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

	if err := db.AutoMigrate(&model.User{}, &model.UserCredential{}, &model.Story{}, &model.StoryNode{}, &model.PlaySession{}, &model.LLMConnection{}, &model.PlatformLLMSetting{}, &model.UserStoryLLMConfig{}, &model.LLMUsageLog{}); err != nil {
		log.Fatalf("failed to migrate: %v", err)
	}

	// 不再 seed：demo 数据已在库中。原实现每次启动都会跑重复项清理与「迷雾古堡」硬删，
	// 等于在生产库上执行夹具代码的删除逻辑，职责错位。
	// **干净数据库启动将没有任何用户和作品**——注册一个账号自行创作即可。

	// Repositories
	userRepo := repository.NewUserRepository(db)
	storyRepo := repository.NewStoryRepository(db)
	nodeRepo := repository.NewNodeRepository(db)
	sessionRepo := repository.NewPlaySessionRepository(db)
	llmRepo := repository.NewLLMRepository(db)

	// Services
	agentClient := service.NewAgentClient(cfg.AgentURL)
	llmResolver := service.NewLLMResolver(llmRepo, cfg.EncryptionKey) // BYOK：按环节解析下发配置
	creditSvc := service.NewCreditService(llmRepo)                    // 平台额度（注册赠 1 元）扣费
	userSvc := service.NewUserService(userRepo, cfg.JWTSecret, cfg.EncryptionKey)
	storySvc := service.NewStoryService(storyRepo)
	llmSvc := service.NewLLMService(llmRepo, agentClient, cfg.EncryptionKey, llmResolver)
	playSvc := service.NewPlayService(sessionRepo, nodeRepo, storyRepo, agentClient, llmResolver, creditSvc)
	uploadSvc := service.NewUploadService(cfg.UploadDir, cfg.UploadMaxBytes())

	// Handlers
	userH := handler.NewUserHandler(userSvc)
	storyH := handler.NewStoryHandler(storySvc)
	playH := handler.NewPlayHandler(playSvc)
	assistH := handler.NewAssistHandler(agentClient, llmResolver)
	llmH := handler.NewLLMHandler(llmSvc)
	uploadH := handler.NewUploadHandler(uploadSvc)

	r := gin.Default()
	r.Use(middleware.CORS())
	r.LoadHTMLGlob("../templates/*")
	// 默认 32MB 内存缓冲对「几张图片」偏大；超出部分 gin 会落临时文件。
	r.MaxMultipartMemory = 8 << 20

	// 最小游玩界面
	r.GET("/", func(c *gin.Context) {
		c.HTML(200, "index.html", gin.H{"title": "AI 互动剧情"})
	})

	api := r.Group("/api/v1")

	// 图片上传：通用端点（需登录），只产出 URL；绑定到头像/封面各走已有的资料/作品更新接口。
	// 静态直出挂在 /api/v1/uploads 而非裸 /uploads —— 生产 nginx 的 location / 会把后者
	// 转给 Next.js（详见 service.UploadPathPrefix 注释）。
	api.POST("/uploads/image", middleware.AuthRequired(cfg.JWTSecret), uploadH.Image)
	api.Static("/uploads", cfg.UploadDir)

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
		// AuthOptional 而非公开：作者要能读到自己的草稿，service 靠 viewerID 分流；
		// 未登录拿 uuid.Nil，只看得到 published。
		stories.GET("/:id", middleware.AuthOptional(cfg.JWTSecret), storyH.Get)
		stories.PUT("/:id", middleware.AuthRequired(cfg.JWTSecret), storyH.Update)
		stories.PUT("/:id/status", middleware.AuthRequired(cfg.JWTSecret), storyH.SetStatus)
		stories.DELETE("/:id", middleware.AuthRequired(cfg.JWTSecret), storyH.Delete)
	}

	// 游玩：一律需登录。匿名曾共用同一个 guest 身份，导致任意匿名者可读/删他人存档；
	// 且生成必须解析到模型，平台额度从不发给匿名调用者——AuthOptional 已无存在理由。
	play := api.Group("/play", middleware.AuthRequired(cfg.JWTSecret))
	{
		play.POST("/sessions", playH.Start)
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

	// 社区（点赞/评论/榜单）尚未实现，路由不注册——未注册即 404，比返回
	// success:true 的空壳诚实。实现时按 docs/prd.md 的路线图加回。

	addr := cfg.ServerPort
	fmt.Printf("Server starting on %s\n", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("failed to start server: %v", err)
	}
}
