package handler

import (
	"strconv"

	"backend/internal/middleware"
	"backend/internal/model"
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
		pkg.Error(c, pkg.BadRequest("无效的作品标识"))
		return
	}

	// 路由挂 AuthOptional：未登录时 GetUserID 返回 uuid.Nil，service 据此按非作者处理。
	story, err := h.svc.Get(id, middleware.GetUserID(c))
	if err != nil {
		pkg.Error(c, err)
		return
	}
	if story == nil {
		pkg.Error(c, pkg.NotFound("作品不存在"))
		return
	}

	pkg.Success(c, story)
}

func (h *StoryHandler) Update(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		pkg.Error(c, pkg.BadRequest("无效的作品标识"))
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
		pkg.Error(c, pkg.NotFound("作品不存在"))
		return
	}

	pkg.Success(c, story)
}

// SetStatus 切换作品发布状态（draft/published）。body: {"status": "..."}。
func (h *StoryHandler) SetStatus(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		pkg.Error(c, pkg.BadRequest("无效的作品标识"))
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
		pkg.Error(c, pkg.NotFound("作品不存在"))
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
		pkg.Error(c, pkg.BadRequest("无效的作品标识"))
		return
	}

	userID := middleware.GetUserID(c)
	if err := h.svc.Delete(id, userID); err != nil {
		pkg.Error(c, err)
		return
	}

	pkg.NoContent(c)
}

// Like / Unlike 点赞与取消赞。两条都是 AuthRequired：匿名点赞没有身份可去重
// （/play 已经栽过一次——所有匿名会话共用同一个 guest id，谁也分不清谁）。
// 两条都幂等，重复点不报错，返回的永远是当前真实状态。
func (h *StoryHandler) Like(c *gin.Context) {
	h.setLike(c, true)
}

func (h *StoryHandler) Unlike(c *gin.Context) {
	h.setLike(c, false)
}

func (h *StoryHandler) setLike(c *gin.Context, on bool) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		pkg.Error(c, pkg.BadRequest("无效的作品标识"))
		return
	}

	userID := middleware.GetUserID(c)
	var result *model.LikeResult
	if on {
		result, err = h.svc.Like(id, userID)
	} else {
		result, err = h.svc.Unlike(id, userID)
	}
	if err != nil {
		pkg.Error(c, err)
		return
	}

	pkg.Success(c, result)
}

// listQuery 解析 ?limit / ?offset / ?sort。
//
// ⚠️ **三个参数的非法输入一律回落默认值，不返回 400**——它们是展示参数，
// 一个拼错的 query 不该把首页打死。尤其 offset：Postgres 的 `OFFSET -1` 是语法错误，
// 负数直接传给 GORM 会变成 500。
//
// 不传参时与改动前的契约完全一致：sort=recent、limit=50、offset=0。
func listQuery(c *gin.Context) (offset, limit int, sort string) {
	limit = 50
	if n, err := strconv.Atoi(c.Query("limit")); err == nil && n > 0 {
		limit = n
		if limit > 100 {
			limit = 100
		}
	}
	if n, err := strconv.Atoi(c.Query("offset")); err == nil && n > 0 {
		offset = n
	}
	sort = c.Query("sort")
	if sort != "plays" {
		sort = "recent"
	}
	return offset, limit, sort
}

func (h *StoryHandler) List(c *gin.Context) {
	offset, limit, sort := listQuery(c)
	stories, err := h.svc.List(offset, limit, sort)
	if err != nil {
		pkg.Error(c, err)
		return
	}

	pkg.SuccessWithMeta(c, stories.Stories, gin.H{"total": stories.Total})
}
