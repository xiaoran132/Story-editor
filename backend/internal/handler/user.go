package handler

import (
	"backend/internal/middleware"
	"backend/internal/service"
	"backend/pkg"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type UserHandler struct {
	svc *service.UserService
}

func NewUserHandler(svc *service.UserService) *UserHandler {
	return &UserHandler{svc: svc}
}

func (h *UserHandler) Register(c *gin.Context) {
	var input service.RegisterInput
	if err := c.ShouldBindJSON(&input); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}

	user, err := h.svc.Register(&input)
	if err != nil {
		pkg.Error(c, err)
		return
	}

	pkg.Created(c, user)
}

func (h *UserHandler) Login(c *gin.Context) {
	var input service.LoginInput
	if err := c.ShouldBindJSON(&input); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}

	token, user, err := h.svc.Login(&input)
	if err != nil {
		pkg.Error(c, err)
		return
	}

	pkg.Success(c, gin.H{
		"token": token,
		"user":  user,
	})
}

func (h *UserHandler) GetProfile(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		pkg.Error(c, pkg.Unauthorized("invalid user"))
		return
	}

	user, err := h.svc.GetProfile(userID)
	if err != nil {
		pkg.Error(c, err)
		return
	}

	pkg.Success(c, user)
}

func (h *UserHandler) UpdateProfile(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		pkg.Error(c, pkg.Unauthorized("invalid user"))
		return
	}

	var input service.UpdateProfileInput
	if err := c.ShouldBindJSON(&input); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}

	user, err := h.svc.UpdateProfile(userID, &input)
	if err != nil {
		pkg.Error(c, err)
		return
	}

	pkg.Success(c, user)
}
