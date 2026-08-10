package service

import (
	"backend/internal/model"
	"backend/internal/repository"
	"backend/pkg"
	"context"
	"fmt"
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

	// 邮箱唯一先查：注册表单只有邮箱/昵称/密码，用户名是派生的，
	// 先报「用户名被占」会让用户对着一个自己没填过的字段发懵。
	existingCred, err := s.repo.FindCredential(ctx, "password", input.Email)
	if err != nil {
		return nil, pkg.Internal("database error")
	}
	if existingCred != nil {
		return nil, pkg.Conflict("该邮箱已注册")
	}

	// 用户名留空 → 后端派生一个可用的（唯一性是数据层的事，不该让前端猜）。
	if strings.TrimSpace(input.Username) == "" {
		generated, err := s.generateUsername(ctx, input.Email)
		if err != nil {
			return nil, err
		}
		input.Username = generated
	} else {
		existing, err := s.repo.FindByUsername(ctx, input.Username)
		if err != nil {
			return nil, pkg.Internal("database error")
		}
		if existing != nil {
			return nil, pkg.Conflict("该用户名已被占用")
		}
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

// generateUsername 由邮箱本地部分派生一个未被占用的用户名。
// 前端曾直接用 email.split("@")[0] 当用户名提交，于是 a@gmail.com 与 a@qq.com 必然撞车，
// 且用户看到的错误对不上自己填过的任何一栏——唯一性放回数据层解决。
// 非法字符剔除后为空则回落 "user"；同名时依次加数字后缀。
func (s *UserService) generateUsername(ctx context.Context, email string) (string, error) {
	base := sanitizeUsername(strings.Split(email, "@")[0])
	if base == "" {
		base = "user"
	}
	for i := 0; i < 50; i++ {
		candidate := base
		if i > 0 {
			candidate = fmt.Sprintf("%s%d", base, i+1)
		}
		existing, err := s.repo.FindByUsername(ctx, candidate)
		if err != nil {
			return "", pkg.Internal("database error")
		}
		if existing == nil {
			return candidate, nil
		}
	}
	// 50 个候选全被占：极小概率，用 uuid 片段兜底而不是失败。
	return base + "-" + uuid.NewString()[:8], nil
}

// sanitizeUsername 只保留小写字母/数字/下划线/连字符，并截到 24 字（列宽 30，留后缀余量）。
func sanitizeUsername(raw string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(raw)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '_', r == '-':
			b.WriteRune(r)
		}
		if b.Len() >= 24 {
			break
		}
	}
	return b.String()
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

