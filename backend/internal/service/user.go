package service

import (
	"backend/internal/model"
	"backend/internal/repository"
	"backend/pkg"
	"context"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type UserService struct {
	repo      *repository.UserRepository
	jwtSecret string
}

func NewUserService(repo *repository.UserRepository, jwtSecret string) *UserService {
	return &UserService{repo: repo, jwtSecret: jwtSecret}
}

type RegisterInput struct {
	Username string `json:"username"`
	Nickname string `json:"nickname"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginInput struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type UpdateProfileInput struct {
	Nickname string `json:"nickname"`
	Bio      string `json:"bio"`
}

func (s *UserService) Register(input *RegisterInput) (*model.UserResponse, error) {
	ctx := context.Background()

	// 检查用户名唯一
	existing, err := s.repo.FindByUsername(ctx, input.Username)
	if err != nil {
		return nil, pkg.Internal("database error")
	}
	if existing != nil {
		return nil, pkg.Conflict("username already taken")
	}

	// 检查邮箱唯一（在 user_credentials 中）
	existingCred, err := s.repo.FindCredential(ctx, "password", input.Email)
	if err != nil {
		return nil, pkg.Internal("database error")
	}
	if existingCred != nil {
		return nil, pkg.Conflict("email already registered")
	}

	// bcrypt 哈希
	hash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, pkg.Internal("failed to hash password")
	}
	secret := string(hash)

	user := &model.User{
		Username: input.Username,
		Nickname: input.Nickname,
		Role:     "user",
		Status:   "active",
	}

	credential := &model.UserCredential{
		Provider:   "password",
		Identifier: input.Email,
		Secret:     &secret,
	}

	if err := s.repo.Create(ctx, user, credential); err != nil {
		return nil, pkg.Internal("failed to create user")
	}

	return user.ToResponse(), nil
}

func (s *UserService) Login(input *LoginInput) (string, *model.UserResponse, error) {
	ctx := context.Background()

	cred, err := s.repo.FindCredential(ctx, "password", input.Email)
	if err != nil {
		return "", nil, pkg.Internal("database error")
	}
	if cred == nil {
		return "", nil, pkg.Unauthorized("invalid email or password")
	}

	if cred.Secret == nil {
		return "", nil, pkg.Unauthorized("invalid email or password")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(*cred.Secret), []byte(input.Password)); err != nil {
		return "", nil, pkg.Unauthorized("invalid email or password")
	}

	user, err := s.repo.FindByID(ctx, cred.UserID)
	if err != nil || user == nil {
		return "", nil, pkg.Internal("user not found")
	}

	if user.Status != "active" {
		return "", nil, pkg.Forbidden("account is not active")
	}

	token, err := pkg.GenerateToken(user.ID, s.jwtSecret)
	if err != nil {
		return "", nil, pkg.Internal("failed to generate token")
	}

	return token, user.ToResponse(), nil
}

func (s *UserService) GetProfile(userID uuid.UUID) (*model.UserResponse, error) {
	ctx := context.Background()

	user, err := s.repo.FindByID(ctx, userID)
	if err != nil {
		return nil, pkg.Internal("database error")
	}
	if user == nil {
		return nil, pkg.NotFound("user not found")
	}

	return user.ToResponse(), nil
}

func (s *UserService) UpdateProfile(userID uuid.UUID, input *UpdateProfileInput) (*model.UserResponse, error) {
	ctx := context.Background()

	user, err := s.repo.FindByID(ctx, userID)
	if err != nil {
		return nil, pkg.Internal("database error")
	}
	if user == nil {
		return nil, pkg.NotFound("user not found")
	}

	if input.Nickname != "" {
		user.Nickname = input.Nickname
	}
	if input.Bio != "" {
		user.Bio = input.Bio
	}

	if err := s.repo.Update(ctx, user); err != nil {
		return nil, pkg.Internal("failed to update profile")
	}

	return user.ToResponse(), nil
}
