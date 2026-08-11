package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type User struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Username  string    `gorm:"uniqueIndex;size:30;not null" json:"username"`
	Nickname  string    `gorm:"size:50;not null" json:"nickname"`
	Bio       string    `gorm:"size:200" json:"bio"`
	AvatarURL string    `gorm:"type:text" json:"avatar_url"`
	// CreditMicroCNY 是平台额度余额，单位**微元**（1e-6 元）。整数存储，避免浮点累加误差。
	// 默认 1_000_000 = 1 元：注册即赠，用尽后须在设置里配自己的 LLM 连接才能继续玩。
	// AutoMigrate 加列时 Postgres 会给存量行一并填上默认值，等于老账号也补发一份。
	CreditMicroCNY int64  `gorm:"not null;default:1000000" json:"credit_micro_cny"`
	Role           string `gorm:"size:20;not null;default:user" json:"role"`
	Status         string `gorm:"size:20;not null;default:active" json:"status"`
	FollowerCount  int    `gorm:"not null;default:0" json:"follower_count"`
	FollowingCount int    `gorm:"not null;default:0" json:"following_count"`
	WorkCount      int    `gorm:"not null;default:0" json:"work_count"`
	// LLMKeyCipher 已废弃：旧「单 DeepSeek key」方案的密文列。BYOK 改用 llm_connections 表
	// + 作品级配置（user_story_llm_configs），此列不再读写（0 用户，未迁移），保留仅因 GORM 不删列。
	LLMKeyCipher *string   `gorm:"type:text" json:"-"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (u *User) BeforeCreate(tx *gorm.DB) error {
	if u.ID == uuid.Nil {
		u.ID = uuid.New()
	}
	return nil
}

type UserResponse struct {
	ID             uuid.UUID `json:"id"`
	Username       string    `json:"username"`
	Nickname       string    `json:"nickname"`
	Bio            string    `json:"bio"`
	AvatarURL      string    `json:"avatar_url"`
	CreditMicroCNY int64     `json:"credit_micro_cny"` // 平台额度余额（微元，1e-6 元）
	Role           string    `json:"role"`
	FollowerCount  int       `json:"follower_count"`
	FollowingCount int       `json:"following_count"`
	WorkCount      int       `json:"work_count"`
	CreatedAt      time.Time `json:"created_at"`
}

func (u *User) ToResponse() *UserResponse {
	return &UserResponse{
		ID:             u.ID,
		Username:       u.Username,
		Nickname:       u.Nickname,
		Bio:            u.Bio,
		AvatarURL:      u.AvatarURL,
		CreditMicroCNY: u.CreditMicroCNY,
		Role:           u.Role,
		FollowerCount:  u.FollowerCount,
		FollowingCount: u.FollowingCount,
		WorkCount:      u.WorkCount,
		CreatedAt:      u.CreatedAt,
	}
}

type UserCredential struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID     uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	Provider   string    `gorm:"size:20;not null;uniqueIndex:idx_credential_provider_identifier" json:"provider"`
	Identifier string    `gorm:"size:200;not null;uniqueIndex:idx_credential_provider_identifier" json:"identifier"`
	Secret     *string   `gorm:"type:text" json:"-"`
	OAuthData  *string   `gorm:"type:jsonb" json:"-"` // 仅 OAuth 登录填；密码注册为 NULL（jsonb 拒绝空串 ""）
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (c *UserCredential) BeforeCreate(tx *gorm.DB) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	return nil
}
