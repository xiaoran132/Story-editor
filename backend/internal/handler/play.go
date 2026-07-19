package handler

import (
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
