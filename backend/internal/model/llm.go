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
	Bindings string `gorm:"type:text;not null;default:'{}'" json:"-"`
	// ReviewEnabled 是本作品的「质量审校」开关，**默认关**。
	// 关：不下发 llm_review，agent 整段跳过审校（省一半 token，但失去对 state_delta /
	// summary 的把关）。开：review 环节必须选一条连接，否则保存被拒。
	// 单独一列而不是塞进 Bindings JSON —— 后者的类型是 map[string]StageBinding，
	// 硬塞一个布尔会污染类型。
	ReviewEnabled bool      `gorm:"not null;default:false" json:"review_enabled"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// PlatformLLMSetting 是平台级（全局）某环节的 LLM 设置，由 admin 管理；每环节一行。
// stage ∈ {write, review, world}。玩家/创作者未配自带连接时回退到此，**但要花额度**
// （注册赠 1 元，见 User.CreditMicroCNY）。
//
// 单价随设置一起存：admin 配平台 key 的同时就该配它的价，一处管完，不另建全局价表。
// 单位是「元 / 百万 token」，与各家官网定价页的口径一致，抄进来不用换算。
type PlatformLLMSetting struct {
	Stage           string    `gorm:"size:20;primaryKey" json:"stage"`
	Provider        string    `gorm:"size:20;not null" json:"provider"`
	BaseURL         string    `gorm:"size:200;not null" json:"base_url"`
	APIKeyCipher    string    `gorm:"type:text" json:"-"`
	Model           string    `gorm:"size:80;not null" json:"model"`
	PriceInPerMTok  float64   `gorm:"not null;default:0" json:"price_in_per_mtok"`  // 输入价，元/百万 token
	PriceOutPerMTok float64   `gorm:"not null;default:0" json:"price_out_per_mtok"` // 输出价，元/百万 token
	UpdatedAt       time.Time `json:"updated_at"`
}

// LLMUsageLog 是一次平台额度消费的流水。只记「花了平台额度」的调用；
// 玩家用自己的 key 时不入账（不花我们的钱，也不该被我们记录用量）。
//
// 没有这张表，用户问「我那 1 元花哪了」只能靠猜；排查扣多了/扣少了也无从下手。
type LLMUsageLog struct {
	ID               uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID           uuid.UUID  `gorm:"type:uuid;not null;index:idx_usage_user_time,priority:1" json:"user_id"`
	StoryID          *uuid.UUID `gorm:"type:uuid" json:"story_id"` // 创作侧调用无作品归属，可空
	Stage            string     `gorm:"size:20;not null" json:"stage"`
	Model            string     `gorm:"size:80;not null" json:"model"`
	PromptTokens     int        `gorm:"not null" json:"prompt_tokens"`
	CompletionTokens int        `gorm:"not null" json:"completion_tokens"`
	CostMicroCNY     int64      `gorm:"not null" json:"cost_micro_cny"`
	// Estimated 为真 = 端点没回 usage，token 数是按字符估的。批量为真时说明扣费全靠估算，
	// 这是需要知道的事实，不该被一个精确的数字掩盖。
	Estimated bool      `gorm:"not null;default:false" json:"estimated"`
	CreatedAt time.Time `gorm:"index:idx_usage_user_time,priority:2" json:"created_at"`
}

func (l *LLMUsageLog) BeforeCreate(tx *gorm.DB) error {
	if l.ID == uuid.Nil {
		l.ID = uuid.New()
	}
	return nil
}

// PlatformLLMSettingResponse 是平台设置的外发 DTO：不含 key，只回打码提示。
type PlatformLLMSettingResponse struct {
	Stage           string  `json:"stage"`
	Provider        string  `json:"provider"`
	BaseURL         string  `json:"base_url"`
	Model           string  `json:"model"`
	PriceInPerMTok  float64 `json:"price_in_per_mtok"`
	PriceOutPerMTok float64 `json:"price_out_per_mtok"`
	HasKey          bool    `json:"has_key"`
	KeyHint         string  `json:"key_hint"`
}
