package service

import (
	"backend/internal/model"
	"backend/internal/repository"
	"backend/pkg"
	"context"
	"strings"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type UserService struct {
	repo      *repository.UserRepository
	jwtSecret string
	encKey    string // 加密用户敏感数据（自带 LLM key）的密钥，来自 cfg.EncryptionKey
}

func NewUserService(repo *repository.UserRepository, jwtSecret, encKey string) *UserService {
	return &UserService{repo: repo, jwtSecret: jwtSecret, encKey: encKey}
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

	token, err := pkg.GenerateToken(user.ID, user.Role, s.jwtSecret)
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

// maskKey 把明文 key 打码成 "前缀••••后4位"，用于安全回显（不泄露完整 key）。
// 现由 LLMService（连接/平台设置回显）复用。
func maskKey(key string) string {
	if key == "" {
		return ""
	}
	tail := key
	if len(key) > 4 {
		tail = key[len(key)-4:]
	}
	prefix := ""
	if len(key) >= 3 && strings.HasPrefix(key, "sk-") {
		prefix = "sk-"
	}
	return prefix + "••••" + tail
}

