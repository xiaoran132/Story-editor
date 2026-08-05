package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// LLMConnection 是用户配置的一条「LLM 连接」：一个 OpenAI 兼容端点 + 凭据 + 默认模型。
// 每用户可多条（如 DeepSeek、OpenAI、Moonshot…）。api_key 以 AES-256-GCM 密文落库（pkg.Encrypt）。
type LLMConnection struct {
	ID           uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID       uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	Name         string    `gorm:"size:50;not null" json:"name"`
	Provider     string    `gorm:"size:20;not null" json:"provider"` // 标签：deepseek/openai/moonshot/custom
	BaseURL      string    `gorm:"size:200;not null" json:"base_url"`
	APIKeyCipher string    `gorm:"type:text" json:"-"` // AES-GCM 密文（base64）；绝不外泄明文
	DefaultModel string    `gorm:"size:80;not null" json:"default_model"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (c *LLMConnection) BeforeCreate(tx *gorm.DB) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	return nil
}

// LLMConnectionResponse 是连接的外发 DTO：绝不含明文/密文 key，只回是否已配置 + 打码提示。
type LLMConnectionResponse struct {
	ID           uuid.UUID `json:"id"`
	Name         string    `json:"name"`
	Provider     string    `json:"provider"`
	BaseURL      string    `json:"base_url"`
	DefaultModel string    `json:"default_model"`
	HasKey       bool      `json:"has_key"`
	KeyHint      string    `json:"key_hint"` // 形如 sk-••••后4位（由 service 用 encKey 解密后打码）
	CreatedAt    time.Time `json:"created_at"`
}

// UserStoryLLMConfig 是「某玩家在某作品」下的 LLM 配置：每环节选自己的哪条连接 + 哪个模型。
// 连接/key 仍是用户级（llm_connections），此处只承载「模型选择」（隐含选了哪条连接）。
// stage ∈ {write, review}（游玩相关；创作侧 world 环节走编辑器临时连接，不入此表）。
type UserStoryLLMConfig struct {
	UserID  uuid.UUID `gorm:"type:uuid;primaryKey" json:"user_id"`
	StoryID uuid.UUID `gorm:"type:uuid;primaryKey" json:"story_id"`
	// Bindings 存 {"write":{"conn":"<uuid>","model":"..."},"review":{...}} 的 JSON（TEXT，规避 jsonb 空串）。
	Bindings  string    `gorm:"type:text;not null;default:'{}'" json:"-"`
	UpdatedAt time.Time `json:"updated_at"`
}

// PlatformLLMSetting 是平台级（全局）某环节的 LLM 设置，由 admin 管理；每环节一行。
// stage ∈ {write, review, world}。玩家/创作者未配自带连接时回退到此。
type PlatformLLMSetting struct {
	Stage        string    `gorm:"size:20;primaryKey" json:"stage"`
	Provider     string    `gorm:"size:20;not null" json:"provider"`
	BaseURL      string    `gorm:"size:200;not null" json:"base_url"`
	APIKeyCipher string    `gorm:"type:text" json:"-"`
	Model        string    `gorm:"size:80;not null" json:"model"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// PlatformLLMSettingResponse 是平台设置的外发 DTO：不含 key，只回打码提示。
type PlatformLLMSettingResponse struct {
	Stage        string `json:"stage"`
	Provider     string `json:"provider"`
	BaseURL      string `json:"base_url"`
	Model        string `json:"model"`
	HasKey       bool   `json:"has_key"`
	KeyHint      string `json:"key_hint"`
}
