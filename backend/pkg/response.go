package pkg

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

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
				Message: err.Error(),
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
