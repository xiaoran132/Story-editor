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
	svc     *service.PlayService
	guestID uuid.UUID // 匿名游玩时的回退用户
}

func NewPlayHandler(svc *service.PlayService, guestID uuid.UUID) *PlayHandler {
	return &PlayHandler{svc: svc, guestID: guestID}
}

// player 取当前登录用户；匿名则回退到 guest 用户。
func (h *PlayHandler) player(c *gin.Context) uuid.UUID {
	if uid := middleware.GetUserID(c); uid != uuid.Nil {
		return uid
	}
	return h.guestID
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

	result, err := h.svc.StartSession(h.player(c), req.StoryID)
	if err != nil {
		pkg.Error(c, err)
		return
	}
	pkg.Created(c, result)
}

type choiceReq struct {
	Choice string `json:"choice" binding:"required"`
}

func (h *PlayHandler) Choice(c *gin.Context) {
	sessionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		pkg.Error(c, pkg.BadRequest("invalid session id"))
		return
	}

	var req choiceReq
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}

	result, err := h.svc.MakeChoice(sessionID, req.Choice)
	if err != nil {
		pkg.Error(c, err)
		return
	}
	pkg.Success(c, result)
}

// ChoiceStream 与 Choice 相同，但以 SSE 流式返回：正文增量走 delta 帧、审校拒绝走 revise 帧，
// 结束以 done 帧携带持久化后的 SessionResult；生成中出错以 error 帧告知（此时已是 200 流）。
func (h *PlayHandler) ChoiceStream(c *gin.Context) {
	sessionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		pkg.Error(c, pkg.BadRequest("invalid session id"))
		return
	}
	var req choiceReq
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no") // 禁止反向代理缓冲，保证逐帧下发
	c.Writer.WriteHeader(200)

	send := func(event string, data any) {
		b, _ := json.Marshal(data)
		fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event, b)
		c.Writer.Flush()
	}

	result, err := h.svc.MakeChoiceStream(
		sessionID, req.Choice,
		func(t string) { send("delta", gin.H{"text": t}) },
		func() { send("revise", gin.H{}) },
	)
	if err != nil {
		send("error", gin.H{"detail": err.Error()})
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

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")
	c.Writer.WriteHeader(200)

	send := func(event string, data any) {
		b, _ := json.Marshal(data)
		fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event, b)
		c.Writer.Flush()
	}

	result, err := h.svc.StartOpeningStream(
		sessionID,
		func(t string) { send("delta", gin.H{"text": t}) },
		func() { send("revise", gin.H{}) },
	)
	if err != nil {
		send("error", gin.H{"detail": err.Error()})
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

	result, err := h.svc.Backtrack(sessionID, req.NodeID)
	if err != nil {
		pkg.Error(c, err)
		return
	}
	pkg.Success(c, result)
}

// List 列出当前玩家（匿名回退 guest）的历史会话，供读档/续玩。
func (h *PlayHandler) List(c *gin.Context) {
	items, err := h.svc.ListSessions(h.player(c))
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

	if err := h.svc.DeleteSession(h.player(c), sessionID); err != nil {
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

	result, err := h.svc.GetSession(sessionID)
	if err != nil {
		pkg.Error(c, err)
		return
	}
	pkg.Success(c, result)
}
