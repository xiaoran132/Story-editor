package handler

import (
	"backend/pkg"

	"github.com/gin-gonic/gin"
)

type CommunityHandler struct {
	// TODO: add community service dependency when implemented
}

func NewCommunityHandler() *CommunityHandler {
	return &CommunityHandler{}
}

func (h *CommunityHandler) ListStories(c *gin.Context) {
	// TODO: implement — 分类浏览 / 搜索 / 排行榜
	pkg.Success(c, gin.H{"message": "not implemented"})
}

func (h *CommunityHandler) GetStoryDetail(c *gin.Context) {
	// TODO: implement — 剧情详情页
	pkg.Success(c, gin.H{"message": "not implemented"})
}

func (h *CommunityHandler) Like(c *gin.Context) {
	// TODO: implement — 点赞
	pkg.Success(c, gin.H{"message": "not implemented"})
}

func (h *CommunityHandler) Comment(c *gin.Context) {
	// TODO: implement — 评论
	pkg.Success(c, gin.H{"message": "not implemented"})
}
