package main

import (
	"context"
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

	// llm_connections.default_model 已废弃（连接改为持有一组可选模型，没有「默认模型」）。
	// 字段从 struct 移除后 INSERT 不再带这列，而旧库里它是 NOT NULL 且无默认值——
	// 不先松开约束，新建连接会直接失败。新库上 IF EXISTS 是空操作。GORM 不删列，留孤儿。
	db.Exec("ALTER TABLE IF EXISTS llm_connections ALTER COLUMN default_model DROP NOT NULL")

	if err := db.AutoMigrate(&model.User{}, &model.UserCredential{}, &model.Story{}, &model.StoryLike{}, &model.StoryNode{}, &model.PlaySession{}, &model.LLMConnection{}, &model.PlatformLLMSetting{}, &model.UserStoryLLMConfig{}, &model.UserAssistLLMConfig{}, &model.LLMUsageLog{}); err != nil {
		log.Fatalf("failed to migrate: %v", err)
	}

	// ⚠️ 部分唯一索引必须在 AutoMigrate **之后**显式建：GORM 的模型标签表达不了
	// `WHERE parent_id IS NULL` 这个谓词。它是「一个会话只能有一个根节点」的跨实例兜底。
	// 建不出来就 Fatal——少了它，重复开场只剩进程内单飞一层保护。
	if err := repository.NewNodeRepository(db).EnsureRootIndex(context.Background()); err != nil {
		log.Fatalf("failed to ensure uniq_root_per_session: %v", err)
	}

	// 一次性回填：把旧的单个 default_model 迁进新的 models 列表，免得存量连接在
	// 分层下拉里变成一个空组。条件同时兜住 '' 与 NULL（不假定 GORM 的 default 标签
	// 真落到了 ADD COLUMN 上），也让这条语句幂等。
	db.Exec(`UPDATE llm_connections SET models = to_jsonb(ARRAY[default_model])::text
	         WHERE coalesce(models, '') IN ('', '[]') AND coalesce(default_model, '') <> ''`)

	// 不再 seed：demo 数据已在库中。原实现每次启动都会跑重复项清理与「迷雾古堡」硬删，
	// 等于在生产库上执行夹具代码的删除逻辑，职责错位。
	// **干净数据库启动将没有任何用户和作品**——注册一个账号自行创作即可。

	// Repositories
	userRepo := repository.NewUserRepository(db)
	storyRepo := repository.NewStoryRepository(db)
	storyLikeRepo := repository.NewStoryLikeRepository(db)
	nodeRepo := repository.NewNodeRepository(db)
	sessionRepo := repository.NewPlaySessionRepository(db)
	llmRepo := repository.NewLLMRepository(db)

	// Services
	agentClient := service.NewAgentClient(cfg.AgentURL)
	llmResolver := service.NewLLMResolver(llmRepo, cfg.EncryptionKey) // BYOK：按环节解析下发配置
	creditSvc := service.NewCreditService(llmRepo)                    // 平台额度（注册赠 1 元）扣费
	userSvc := service.NewUserService(userRepo, cfg.JWTSecret, cfg.EncryptionKey)
	storySvc := service.NewStoryService(storyRepo, storyLikeRepo)
	llmSvc := service.NewLLMService(llmRepo, agentClient, cfg.EncryptionKey, llmResolver)
	playSvc := service.NewPlayService(sessionRepo, nodeRepo, storyRepo, agentClient, llmResolver, creditSvc, storyRepo)
	uploadSvc := service.NewUploadService(cfg.UploadDir, cfg.UploadMaxBytes())

	// Handlers
	userH := handler.NewUserHandler(userSvc)
	storyH := handler.NewStoryHandler(storySvc)
	playH := handler.NewPlayHandler(playSvc)
	// 启动自检：ENCRYPTION_KEY 配错时，解析链会把每次解密失败静默当成"没配置"，
	// 玩家看到的是"没有可用的模型"、下拉里是"未开放"，没有任何线索指向密钥。
	// 这里在启动时就把它喊出来。不 Fatal——干净库没有平台设置是正常状态。
	if llmSvc.UndecryptablePlatformKey() {
		log.Printf("⚠️  ENCRYPTION_KEY 与库中密文不匹配：平台兜底设置的 api_key 解不开。" +
			"它会表现为「平台未开放」，用户自带连接（同一把密钥加密）同样会失效、" +
			"表现为「没有可用的模型」。请核对 ENCRYPTION_KEY，或在 /admin 重新录入 key。")
	}

	assistH := handler.NewAssistHandler(agentClient, llmResolver, creditSvc)
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
		// 点赞：AuthRequired，匿名没有身份可去重。两条都幂等。
		stories.POST("/:id/like", middleware.AuthRequired(cfg.JWTSecret), storyH.Like)
		stories.DELETE("/:id/like", middleware.AuthRequired(cfg.JWTSecret), storyH.Unlike)
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
		llm.POST("/connections/models", llmH.ProbeModels)   // 用表单现填的 key 拉模型（连接尚未保存）
		llm.GET("/connections/:id/models", llmH.ListModels) // 用存量 key 重拉某条已存连接的模型
		llm.GET("/assist-config", llmH.GetAssistConfig)     // 创作辅助用哪条连接的哪个模型（账号级）
		llm.PUT("/assist-config", llmH.SetAssistConfig)
		llm.GET("/story-config/:storyId", llmH.GetStoryConfig) // 玩家在某作品的模型配置
		llm.PUT("/story-config/:storyId", llmH.SetStoryConfig)
	}

	// 平台 LLM 兜底设置（仅管理员：AuthRequired + RequireAdmin；全局一条，不分环节）。
	// 第一个 admin 靠手动改库提权。
	adminLLM := api.Group("/admin/llm", middleware.AuthRequired(cfg.JWTSecret), middleware.RequireAdmin())
	{
		adminLLM.GET("/platform", llmH.GetPlatform)
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
