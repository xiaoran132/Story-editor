package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// LLMConnection 是用户配置的一条「LLM 连接」：备注 + 一个 OpenAI 兼容端点 + 凭据 + 一组已选模型。
// 每用户可多条（如 DeepSeek、OpenAI、Moonshot…）。api_key 以 AES-256-GCM 密文落库（pkg.Encrypt）。
//
// **没有「默认模型」这一说**：模型是在用哪个环节/哪部作品时当场选的，连接只负责
// 「这套凭据下有哪些模型可选」。旧的单个 default_model 列已废弃，留作孤儿（GORM 不删列）。
type LLMConnection struct {
	ID           uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID       uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	Name         string    `gorm:"size:50;not null" json:"name"`
	Provider     string    `gorm:"size:20;not null" json:"provider"` // 标签：deepseek/openai/moonshot/custom
	BaseURL      string    `gorm:"size:200;not null" json:"base_url"`
	APIKeyCipher string    `gorm:"type:text" json:"-"` // AES-GCM 密文（base64）；绝不外泄明文
	// Models 是用户从端点 /models 拉取后勾选（或手填补充）的模型 id 列表，存 JSON 数组。
	// 整体读写，没有单查一个模型的需求，因此不另立一张表。
	Models    string    `gorm:"type:text;not null;default:'[]'" json:"-"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (c *LLMConnection) BeforeCreate(tx *gorm.DB) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	return nil
}

// LLMConnectionResponse 是连接的外发 DTO：绝不含明文/密文 key，只回是否已配置 + 打码提示。
type LLMConnectionResponse struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Provider  string    `json:"provider"`
	BaseURL   string    `json:"base_url"`
	Models    []string  `json:"models"` // 可选模型列表（由 Models JSON 解析而来）
	HasKey    bool      `json:"has_key"`
	KeyHint   string    `json:"key_hint"` // 形如 sk-••••后4位（由 service 用 encKey 解密后打码）
	CreatedAt time.Time `json:"created_at"`
}

// UserAssistLLMConfig 是「某创作者的创作辅助（world 环节）用哪条连接的哪个模型」，每用户一行。
//
// 为什么不塞进 UserStoryLLMConfig：那张表按 (user, story) 复合主键，而创作辅助在
// **作品还不存在时**就要用（第一步就是「AI 生成世界观」），没有 story_id 可挂。
// 它也确实是账号级偏好——同一个创作者在所有作品里用同一套辅助模型。
//
// ConnID 为 nil = 用平台 world 档（需额度）。Model 在 ConnID 非空时必填，
// 与 StageBinding 同一条规则：连接不持有默认模型。
type UserAssistLLMConfig struct {
	UserID    uuid.UUID  `gorm:"type:uuid;primaryKey" json:"user_id"`
	ConnID    *uuid.UUID `gorm:"type:uuid" json:"-"`
	Model     string     `gorm:"size:80;not null;default:''" json:"model"`
	UpdatedAt time.Time  `json:"updated_at"`
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
