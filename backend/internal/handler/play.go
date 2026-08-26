package handler

import (
	"encoding/json"
	"fmt"

	"backend/internal/middleware"
	"backend/internal/service"
	"backend/pkg"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type PlayHandler struct {
	svc *service.PlayService
}

func NewPlayHandler(svc *service.PlayService) *PlayHandler {
	return &PlayHandler{svc: svc}
}

// player 取当前玩家。/play 全组挂 AuthRequired，到这里必定非 Nil。
// （曾经匿名回退到共享 guest ID，使 checkSessionOwner 形同虚设——已移除。）
func (h *PlayHandler) player(c *gin.Context) uuid.UUID {
	return middleware.GetUserID(c)
}

type startSessionReq struct {
	StoryID uuid.UUID `json:"story_id" binding:"required"`
}

func (h *PlayHandler) Start(c *gin.Context) {
	var req startSessionReq
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}

	result, err := h.svc.StartSession(c.Request.Context(), h.player(c), req.StoryID)
	if err != nil {
		pkg.Error(c, err)
		return
	}
	pkg.Created(c, result)
}

type choiceReq struct {
	Choice string `json:"choice" binding:"required"`
}

// sseStart 设置 SSE 响应头并返回逐帧发送函数（event/data + flush）。ChoiceStream/OpeningStream 共用。
//
// ⚠️ error 帧的 detail 一律经 pkg.SafeDetail，不用 err.Error()：SSE 是**唯一**能把
// service 层错误原文直送浏览器的通道（普通路由至少还过一次 pkg.Error）。
func sseStart(c *gin.Context) func(event string, data any) {
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no") // 禁反代缓冲，保证逐帧下发
	c.Writer.WriteHeader(200)
	return func(event string, data any) {
		b, _ := json.Marshal(data)
		fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event, b)
		c.Writer.Flush()
	}
}

// ChoiceStream 流式续写（SSE）：delta 正文增量 / revise 审校重来 / done 持久化后的 SessionResult / error。
func (h *PlayHandler) ChoiceStream(c *gin.Context) {
	sessionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		pkg.Error(c, pkg.BadRequest("invalid session id"))
		return
	}
	var req choiceReq
	if err := c.ShouldBindJSON(&req); err != nil { // 绑定在开流前，坏 body 走正常 JSON 错误
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}
	send := sseStart(c)
	result, err := h.svc.MakeChoiceStream(
		c.Request.Context(), sessionID, h.player(c), req.Choice,
		func(t string) { send("delta", gin.H{"text": t}) },
		func() { send("revise", gin.H{}) },
	)
	if err != nil {
		send("error", gin.H{"detail": pkg.SafeDetail(err)})
		return
	}
	send("done", result)
}

// OpeningStream 为空会话流式生成开场（SSE，帧格式同 ChoiceStream）。
// 游玩页发现会话尚无当前节点时调用；幂等（开场已生成则直接 done 返回既有节点）。
func (h *PlayHandler) OpeningStream(c *gin.Context) {
	sessionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		pkg.Error(c, pkg.BadRequest("invalid session id"))
		return
	}
	send := sseStart(c)
	result, err := h.svc.StartOpeningStream(
		c.Request.Context(), sessionID, h.player(c),
		func(t string) { send("delta", gin.H{"text": t}) },
		func() { send("revise", gin.H{}) },
	)
	if err != nil {
		send("error", gin.H{"detail": pkg.SafeDetail(err)})
		return
	}
	send("done", result)
}

type backtrackReq struct {
	NodeID uuid.UUID `json:"node_id" binding:"required"`
}

func (h *PlayHandler) Backtrack(c *gin.Context) {
	sessionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		pkg.Error(c, pkg.BadRequest("invalid session id"))
		return
	}

	var req backtrackReq
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}

	result, err := h.svc.Backtrack(c.Request.Context(), h.player(c), sessionID, req.NodeID)
	if err != nil {
		pkg.Error(c, err)
		return
	}
	pkg.Success(c, result)
}

// List 列出当前玩家（匿名回退 guest）的历史会话，供读档/续玩。
func (h *PlayHandler) List(c *gin.Context) {
	items, err := h.svc.ListSessions(c.Request.Context(), h.player(c))
	if err != nil {
		pkg.Error(c, err)
		return
	}
	pkg.Success(c, items)
}

// Delete 删除当前玩家名下的一局会话（含全部节点）。
func (h *PlayHandler) Delete(c *gin.Context) {
	sessionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		pkg.Error(c, pkg.BadRequest("invalid session id"))
		return
	}

	if err := h.svc.DeleteSession(c.Request.Context(), h.player(c), sessionID); err != nil {
		pkg.Error(c, err)
		return
	}
	pkg.NoContent(c)
}

func (h *PlayHandler) Get(c *gin.Context) {
	sessionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		pkg.Error(c, pkg.BadRequest("invalid session id"))
		return
	}

	result, err := h.svc.GetSession(c.Request.Context(), h.player(c), sessionID)
	if err != nil {
		pkg.Error(c, err)
		return
	}
	pkg.Success(c, result)
}
