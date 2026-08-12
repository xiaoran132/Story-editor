package handler

import (

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
	resolver *service.LLMResolver // BYOK：按创作者环节解析下发配置
}

func NewAssistHandler(agent *service.AgentClient, resolver *service.LLMResolver) *AssistHandler {
	return &AssistHandler{agent: agent, resolver: resolver}
}

// resolveWorld 解析当前创作者 world 环节的下发配置（connOverride 为前端可选覆盖连接）。
//
// 解析不到就返回错误，**不发那个注定失败的请求**：agent 已无任何默认凭据，
// 发过去只会换来一句"AI 服务暂不可用"，而真正的原因是"你还没有可用的模型"。
func (h *AssistHandler) resolveWorld(c *gin.Context, connOverride *uuid.UUID) (*service.AgentLLMConfig, error) {
	if h.resolver == nil {
		return nil, noModelErr()
	}
	cfg, err := h.resolver.ResolveForAssist(c.Request.Context(), middleware.GetUserID(c), connOverride)
	if err != nil {
		return nil, err // 存储故障：如实上抛，别说成「你没配模型」
	}
	if cfg == nil {
		return nil, noModelErr()
	}
	return cfg, nil
}

// noModelErr 是创作侧「没有可用模型」的文案，指向编辑器里的连接下拉。
func noModelErr() *pkg.AppError {
	return pkg.NewBusinessErrorWithMessage(pkg.CodeNoLLMConfig,
		"没有可用的模型：平台赠送额度已用尽或未开放。请在「个人主页 → AI 连接」添加一条连接，并在上方「使用连接」里选中它。")
}

// aiErr 把 agent 调用失败包成统一业务错误（避免把内部 502/网络细节直接抛给前端）。
func aiErr() *pkg.AppError {
	return pkg.NewBusinessErrorWithMessage(bizCodeAIUnavailable, "AI 服务暂不可用，请稍后重试")
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
	req.LLM = cfg // 服务端填充，覆盖客户端任何传入
	draft, err := h.agent.AssistWorld(c.Request.Context(), req)
	if err != nil {
		pkg.Error(c, aiErr())
		return
	}
	pkg.Success(c, draft)
}

// Opening 世界观 → 开场草稿。
func (h *AssistHandler) Opening(c *gin.Context) {
	var req service.AssistOpeningRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}
	// 开场走完整 play 管线：写手用 world 环节覆盖连接（编辑器语境统一按 world 归属）。
	cfg, cfgErr := h.resolveWorld(c, req.ConnectionID)
	if cfgErr != nil {
		pkg.Error(c, cfgErr)
		return
	}
	req.LLMWrite = cfg
	// 创作侧不开审校：作者要的是快出草稿，且这里没有作品级开关可读。
	req.LLMReview = nil
	draft, err := h.agent.AssistOpening(c.Request.Context(), req)
	if err != nil {
		pkg.Error(c, aiErr())
		return
	}
	pkg.Success(c, draft)
}

// Polish 文本润色。
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
	pkg.Success(c, res)
}
