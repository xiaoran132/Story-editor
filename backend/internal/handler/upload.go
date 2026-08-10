package handler

import (
	"backend/internal/service"
	"backend/pkg"

	"github.com/gin-gonic/gin"
)

type UploadHandler struct {
	svc *service.UploadService
}

func NewUploadHandler(svc *service.UploadService) *UploadHandler {
	return &UploadHandler{svc: svc}
}

// Image 接收一张图片，返回可直接访问的 URL。
//
// 全仓唯一的 multipart 端点（其余都是 ShouldBindJSON），所以这里没法复用
// service 侧的 Input 结构体。上传与「绑定到哪」刻意分开：这里只负责产出 URL，
// 头像/封面各自走已有的 PUT /auth/profile、PUT /stories/:id 落库。
func (h *UploadHandler) Image(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		pkg.Error(c, pkg.BadRequest("缺少上传文件"))
		return
	}

	src, err := file.Open()
	if err != nil {
		pkg.Error(c, pkg.BadRequest("无法读取上传文件"))
		return
	}
	defer src.Close()

	url, err := h.svc.SaveImage(c.PostForm("kind"), src)
	if err != nil {
		pkg.Error(c, err)
		return
	}

	pkg.Success(c, gin.H{"url": url})
}
