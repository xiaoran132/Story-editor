package handler

import (
	"backend/internal/middleware"
	"backend/internal/service"
	"backend/pkg"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// LLMHandler 处理用户 LLM 连接（CRUD）、环节绑定、连接测试，以及平台设置（admin）。
type LLMHandler struct {
	svc *service.LLMService
}

func NewLLMHandler(svc *service.LLMService) *LLMHandler {
	return &LLMHandler{svc: svc}
}

// ----- 用户连接 -----

func (h *LLMHandler) ListConnections(c *gin.Context) {
	items, err := h.svc.ListConnections(middleware.GetUserID(c))
	if err != nil {
		pkg.Error(c, err)
		return
	}
	pkg.Success(c, items)
}

func (h *LLMHandler) CreateConnection(c *gin.Context) {
	var in service.ConnectionInput
	if err := c.ShouldBindJSON(&in); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}
	res, err := h.svc.CreateConnection(middleware.GetUserID(c), &in)
	if err != nil {
		pkg.Error(c, err)
		return
	}
	pkg.Created(c, res)
}

func (h *LLMHandler) UpdateConnection(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		pkg.Error(c, pkg.BadRequest("无效的连接标识"))
		return
	}
	var in service.ConnectionInput
	if err := c.ShouldBindJSON(&in); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}
	res, err := h.svc.UpdateConnection(middleware.GetUserID(c), id, &in)
	if err != nil {
		pkg.Error(c, err)
		return
	}
	pkg.Success(c, res)
}

func (h *LLMHandler) DeleteConnection(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		pkg.Error(c, pkg.BadRequest("无效的连接标识"))
		return
	}
	if err := h.svc.DeleteConnection(middleware.GetUserID(c), id); err != nil {
		pkg.Error(c, err)
		return
	}
	pkg.NoContent(c)
}

// TestConnection 用给定/存量配置做一次性 ping，判断连接是否可用（不落库、不进生成管线）。
func (h *LLMHandler) TestConnection(c *gin.Context) {
	var in service.TestConnectionInput
	if err := c.ShouldBindJSON(&in); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}
	res, err := h.svc.TestConnection(middleware.GetUserID(c), &in)
	if err != nil {
		pkg.Error(c, err)
		return
	}
	pkg.Success(c, res)
}

// ----- 模型列表 -----

// ProbeModels 用表单里现填的 base_url/api_key 问端点有哪些模型——**连接还没存**时唯一的路。
// 已存连接可只传 connection_id 复用存量 key（key 不回显，编辑时用户通常不重填）。
func (h *LLMHandler) ProbeModels(c *gin.Context) {
	var in service.ProbeModelsInput
	if err := c.ShouldBindJSON(&in); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}
	models, err := h.svc.ProbeModels(middleware.GetUserID(c), &in)
	if err != nil {
		pkg.Error(c, err)
		return
	}
	pkg.Success(c, gin.H{"models": models})
}

// ListModels 拉取某连接端点的可用模型 id 列表（下拉用；拉不到前端回退手填）。
func (h *LLMHandler) ListModels(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		pkg.Error(c, pkg.BadRequest("无效的连接标识"))
		return
	}
	models, err := h.svc.ListModels(middleware.GetUserID(c), id)
	if err != nil {
		pkg.Error(c, err)
		return
	}
	pkg.Success(c, gin.H{"models": models})
}

// ----- 创作辅助配置（账号级） -----

func (h *LLMHandler) GetAssistConfig(c *gin.Context) {
	res, err := h.svc.GetAssistConfig(middleware.GetUserID(c))
	if err != nil {
		pkg.Error(c, err)
		return
	}
	pkg.Success(c, res)
}

func (h *LLMHandler) SetAssistConfig(c *gin.Context) {
	var in service.AssistConfigInput
	if err := c.ShouldBindJSON(&in); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}
	res, err := h.svc.SetAssistConfig(middleware.GetUserID(c), in)
	if err != nil {
		pkg.Error(c, err)
		return
	}
	pkg.Success(c, res)
}

// ----- 作品级模型配置 -----

func (h *LLMHandler) GetStoryConfig(c *gin.Context) {
	storyID, err := uuid.Parse(c.Param("storyId"))
	if err != nil {
		pkg.Error(c, pkg.BadRequest("无效的作品标识"))
		return
	}
	b, err := h.svc.GetStoryConfig(middleware.GetUserID(c), storyID)
	if err != nil {
		pkg.Error(c, err)
		return
	}
	pkg.Success(c, b)
}

func (h *LLMHandler) SetStoryConfig(c *gin.Context) {
	storyID, err := uuid.Parse(c.Param("storyId"))
	if err != nil {
		pkg.Error(c, pkg.BadRequest("无效的作品标识"))
		return
	}
	var in service.StoryLLMConfigInput
	if err := c.ShouldBindJSON(&in); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}
	b, err := h.svc.SetStoryConfig(middleware.GetUserID(c), storyID, in)
	if err != nil {
		pkg.Error(c, err)
		return
	}
	pkg.Success(c, b)
}

// ----- 平台设置（admin，路由挂 RequireAdmin） -----

func (h *LLMHandler) ListPlatform(c *gin.Context) {
	items, err := h.svc.ListPlatform()
	if err != nil {
		pkg.Error(c, err)
		return
	}
	pkg.Success(c, items)
}

// UpsertPlatform body: {stage, provider, base_url, api_key, model}。
func (h *LLMHandler) UpsertPlatform(c *gin.Context) {
	var body struct {
		Stage string `json:"stage"`
		service.PlatformInput
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}
	res, err := h.svc.UpsertPlatform(body.Stage, &body.PlatformInput)
	if err != nil {
		pkg.Error(c, err)
		return
	}
	pkg.Success(c, res)
}

// TestPlatform 复用用户测试逻辑（admin 填的平台配置一次性 ping）。
func (h *LLMHandler) TestPlatform(c *gin.Context) {
	var in service.TestConnectionInput
	if err := c.ShouldBindJSON(&in); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}
	// 平台测试不涉及用户存量连接，connection_id 恒空；直接用表单 api_key/base_url/model。
	in.ConnectionID = nil
	res, err := h.svc.TestConnection(uuid.Nil, &in)
	if err != nil {
		pkg.Error(c, err)
		return
	}
	pkg.Success(c, res)
}
