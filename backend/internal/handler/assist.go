package handler

import (
	"context"

	"backend/internal/middleware"
	"backend/internal/service"
	"backend/pkg"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// bizCodeAIUnavailable 是 agent 服务不可用时返回的业务错误码。
const bizCodeAIUnavailable = 10013

// AssistHandler 转发创作辅助请求到 Python agent 的 /assist/*。
// agent 无鉴权/CORS，故一律经 Go（本组路由挂 AuthRequired），前端不直连。
type AssistHandler struct {
	agent    *service.AgentClient
	resolver *service.LLMResolver
	credit   *service.CreditService
}

func NewAssistHandler(agent *service.AgentClient, resolver *service.LLMResolver, credit *service.CreditService) *AssistHandler {
	return &AssistHandler{agent: agent, resolver: resolver, credit: credit}
}

// resolveWorld 沿用创作侧的模型解析顺序：编辑器连接覆盖、平台 world、无模型错误。
func (h *AssistHandler) resolveWorld(c *gin.Context, connOverride *uuid.UUID) (*service.AgentLLMConfig, error) {
	if h.resolver == nil {
		return nil, noModelErr()
	}
	cfg, err := h.resolver.ResolveForAssist(c.Request.Context(), middleware.GetUserID(c), connOverride)
	if err != nil {
		return nil, err
	}
	if cfg == nil {
		return nil, noModelErr()
	}
	return cfg, nil
}

func noModelErr() *pkg.AppError {
	return pkg.NewBusinessErrorWithMessage(pkg.CodeNoLLMConfig,
		"没有可用的模型：平台赠送额度已用尽或未开放。请在「个人主页 → AI 连接」添加一条连接，并在上方「使用连接」里选中它。")
}

func aiErr() *pkg.AppError {
	return pkg.NewBusinessErrorWithMessage(bizCodeAIUnavailable, "AI 服务暂不可用，请稍后重试")
}

// chargeAssist records known token usage only after a successful Agent response. Charge is a
// best-effort post-action and internally skips user-owned connections.
func (h *AssistHandler) chargeAssist(c *gin.Context, stage string, cfg *service.AgentLLMConfig, usage service.TokenUsage) {
	if h.credit == nil {
		return
	}
	h.credit.Charge(context.WithoutCancel(c.Request.Context()), middleware.GetUserID(c), nil, stage, cfg, usage)
}

// World 一句话灵感 → 完整世界观草稿。
func (h *AssistHandler) World(c *gin.Context) {
	var req service.AssistWorldRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}
	if req.Idea == "" {
		pkg.Error(c, pkg.BadRequest("idea 不能为空"))
		return
	}
	cfg, cfgErr := h.resolveWorld(c, req.ConnectionID)
	if cfgErr != nil {
		pkg.Error(c, cfgErr)
		return
	}
	req.LLM = cfg // 服务端覆盖客户端任何 LLM 字段
	draft, err := h.agent.AssistWorld(c.Request.Context(), req)
	if err != nil {
		pkg.Error(c, aiErr())
		return
	}
	h.chargeAssist(c, service.StageAssistWorld, cfg, draft.Usage)
	pkg.Success(c, draft)
}

// Opening 世界观 → 开场草稿。
func (h *AssistHandler) Opening(c *gin.Context) {
	var req service.AssistOpeningRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}
	cfg, cfgErr := h.resolveWorld(c, req.ConnectionID)
	if cfgErr != nil {
		pkg.Error(c, cfgErr)
		return
	}
	req.LLMWrite = cfg
	// 创作开场沿用现有快速草稿行为，不启用玩家 Hard Review。
	req.LLMReview = nil
	draft, err := h.agent.AssistOpening(c.Request.Context(), req)
	if err != nil {
		pkg.Error(c, aiErr())
		return
	}
	h.chargeAssist(c, service.StageAssistOpening, cfg, draft.Usage)
	pkg.Success(c, draft)
}

// Polish 对完整开场正文运行作者侧精品润色闭环。
func (h *AssistHandler) Polish(c *gin.Context) {
	var req service.AssistPolishRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}
	if req.Text == "" {
		pkg.Error(c, pkg.BadRequest("text 不能为空"))
		return
	}
	cfg, cfgErr := h.resolveWorld(c, req.ConnectionID)
	if cfgErr != nil {
		pkg.Error(c, cfgErr)
		return
	}
	req.LLM = cfg
	draft, err := h.agent.AssistPolish(c.Request.Context(), req)
	if err != nil {
		pkg.Error(c, aiErr())
		return
	}
	h.chargeAssist(c, service.StageAssistPolish, cfg, draft.Usage)
	pkg.Success(c, draft)
}

// Branches 为当前节点建议后续分支。
func (h *AssistHandler) Branches(c *gin.Context) {
	var req service.AssistBranchesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}
	if req.Content == "" {
		pkg.Error(c, pkg.BadRequest("content 不能为空"))
		return
	}
	cfg, cfgErr := h.resolveWorld(c, req.ConnectionID)
	if cfgErr != nil {
		pkg.Error(c, cfgErr)
		return
	}
	req.LLM = cfg
	res, err := h.agent.AssistBranches(c.Request.Context(), req)
	if err != nil {
		pkg.Error(c, aiErr())
		return
	}
	h.chargeAssist(c, service.StageAssistBranches, cfg, res.Usage)
	pkg.Success(c, res)
}
