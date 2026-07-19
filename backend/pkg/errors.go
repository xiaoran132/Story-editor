package pkg

import "net/http"

type AppError struct {
	StatusCode int    `json:"-"`
	BizCode    int    `json:"code"`
	Message    string `json:"message"`
}

func (e *AppError) Error() string {
	return e.Message
}

func BadRequest(msg string) *AppError {
	return &AppError{StatusCode: http.StatusBadRequest, BizCode: 400, Message: msg}
}

func Unauthorized(msg string) *AppError {
	return &AppError{StatusCode: http.StatusUnauthorized, BizCode: 401, Message: msg}
}

func Forbidden(msg string) *AppError {
	return &AppError{StatusCode: http.StatusForbidden, BizCode: 403, Message: msg}
}

func NotFound(msg string) *AppError {
	return &AppError{StatusCode: http.StatusNotFound, BizCode: 404, Message: msg}
}

func Conflict(msg string) *AppError {
	return &AppError{StatusCode: http.StatusConflict, BizCode: 409, Message: msg}
}

func Internal(msg string) *AppError {
	return &AppError{StatusCode: http.StatusInternalServerError, BizCode: 500, Message: msg}
}

// NewBusinessError 业务错误码 10001-10011
func NewBusinessError(code int) *AppError {
	return &AppError{StatusCode: http.StatusBadRequest, BizCode: code, Message: "business error"}
}

func NewBusinessErrorWithMessage(code int, msg string) *AppError {
	return &AppError{StatusCode: http.StatusBadRequest, BizCode: code, Message: msg}
}
