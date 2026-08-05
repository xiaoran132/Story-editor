package handler

import (
	"backend/internal/middleware"
	"backend/internal/service"
	"backend/pkg"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type StoryHandler struct {
	svc *service.StoryService
}

func NewStoryHandler(svc *service.StoryService) *StoryHandler {
	return &StoryHandler{svc: svc}
}

func (h *StoryHandler) Create(c *gin.Context) {
	var input service.StoryCreateInput
	if err := c.ShouldBindJSON(&input); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}

	userID := middleware.GetUserID(c)
	story, err := h.svc.Create(userID, &input)
	if err != nil {
		pkg.Error(c, err)
		return
	}

	pkg.Created(c, story)
}

func (h *StoryHandler) Get(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		pkg.Error(c, pkg.BadRequest("invalid story id"))
		return
	}

	story, err := h.svc.Get(id)
	if err != nil {
		pkg.Error(c, err)
		return
	}
	if story == nil {
		pkg.Error(c, pkg.NotFound("story not found"))
		return
	}

	pkg.Success(c, story)
}

func (h *StoryHandler) Update(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		pkg.Error(c, pkg.BadRequest("invalid story id"))
		return
	}

	var input service.StoryUpdateInput
	if err := c.ShouldBindJSON(&input); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}

	userID := middleware.GetUserID(c)
	story, err := h.svc.Update(id, userID, &input)
	if err != nil {
		pkg.Error(c, err)
		return
	}
	if story == nil {
		pkg.Error(c, pkg.NotFound("story not found"))
		return
	}

	pkg.Success(c, story)
}

// SetStatus 切换作品发布状态（draft/published）。body: {"status": "..."}。
func (h *StoryHandler) SetStatus(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		pkg.Error(c, pkg.BadRequest("invalid story id"))
		return
	}

	var body struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}

	userID := middleware.GetUserID(c)
	story, err := h.svc.SetStatus(id, userID, body.Status)
	if err != nil {
		pkg.Error(c, err)
		return
	}
	if story == nil {
		pkg.Error(c, pkg.NotFound("story not found"))
		return
	}

	pkg.Success(c, story)
}

// ListMine 返回当前登录创作者的全部作品（含草稿）。
func (h *StoryHandler) ListMine(c *gin.Context) {
	userID := middleware.GetUserID(c)
	stories, err := h.svc.ListMine(userID, 0, 100)
	if err != nil {
		pkg.Error(c, err)
		return
	}
	pkg.SuccessWithMeta(c, stories.Stories, gin.H{"total": stories.Total})
}

func (h *StoryHandler) Delete(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		pkg.Error(c, pkg.BadRequest("invalid story id"))
		return
	}

	userID := middleware.GetUserID(c)
	if err := h.svc.Delete(id, userID); err != nil {
		pkg.Error(c, err)
		return
	}

	pkg.NoContent(c)
}

func (h *StoryHandler) List(c *gin.Context) {
	stories, err := h.svc.List(0, 50)
	if err != nil {
		pkg.Error(c, err)
		return
	}

	pkg.SuccessWithMeta(c, stories.Stories, gin.H{"total": stories.Total})
}
