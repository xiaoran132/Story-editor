package pkg

import (
	"context"
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

// internalDetail 是「出了我们不打算解释的事」时对外说的话。
const internalDetail = "服务器内部错误，请稍后重试"

// SafeDetail 回**可以外发**的错误文案，是「什么错误能给用户看」的唯一判定处。
//
// AppError 的 Message 是我们自己写给用户看的，原样给。其余多为裸 GORM/pgx 错误，
// 文本里带表名、列名、约束名，只记服务端日志、对外回固定文案。
//
// ⚠️ context.Canceled 单独短路：玩家关掉页面就会走到这里（如 play.go 里 follower
// 等待共享开场时的 ctx.Err()）。它不是故障，记进日志只会把真正的 500 淹掉。
func SafeDetail(err error) string {
	if err == nil {
		return ""
	}
	if appErr, ok := err.(*AppError); ok {
		return appErr.Message
	}
	if errors.Is(err, context.Canceled) {
		return "请求已取消"
	}
	log.Printf("unhandled error: %v", err)
	return internalDetail
}

type Response struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data"`
	Error   interface{} `json:"error"`
	Meta    interface{} `json:"meta,omitempty"`
}

type ErrorBody struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func Success(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, Response{
		Success: true,
		Data:    data,
		Error:   nil,
	})
}

func Created(c *gin.Context, data interface{}) {
	c.JSON(http.StatusCreated, Response{
		Success: true,
		Data:    data,
		Error:   nil,
	})
}

func SuccessWithMeta(c *gin.Context, data, meta interface{}) {
	c.JSON(http.StatusOK, Response{
		Success: true,
		Data:    data,
		Error:   nil,
		Meta:    meta,
	})
}

func Error(c *gin.Context, err error) {
	appErr, ok := err.(*AppError)
	if !ok {
		c.JSON(http.StatusInternalServerError, Response{
			Success: false,
			Data:    nil,
			Error: ErrorBody{
				Code:    500,
				Message: SafeDetail(err),
			},
		})
		return
	}

	statusCode := appErr.StatusCode
	if statusCode == 0 {
		statusCode = http.StatusInternalServerError
	}

	c.JSON(statusCode, Response{
		Success: false,
		Data:    nil,
		Error: ErrorBody{
			Code:    appErr.BizCode,
			Message: appErr.Message,
		},
	})
}

func NoContent(c *gin.Context) {
	c.JSON(http.StatusNoContent, Response{
		Success: true,
		Data:    nil,
		Error:   nil,
	})
}
