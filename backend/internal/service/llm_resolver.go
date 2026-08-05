package service

import (
	"context"
	"encoding/json"

	"backend/internal/model"
	"backend/pkg"

	"github.com/google/uuid"
)

// 环节常量：续写/开场用 write，质量审校用 review，创作侧世界观/润色/分支用 world。
const (
	StageWrite  = "write"
	StageReview = "review"
	StageWorld  = "world"
)

// ValidStages 是全部合法环节（平台设置用，含创作侧 world）。
var ValidStages = map[string]bool{StageWrite: true, StageReview: true, StageWorld: true}

// PlayStages 是游玩相关、可在作品级配置的环节；world 属创作侧、不入作品配置。
var PlayStages = map[string]bool{StageWrite: true, StageReview: true}

// StageBinding 是「某环节 → 用哪条连接的哪个模型」。Model 为空则回退连接的 DefaultModel。
type StageBinding struct {
	Conn  string `json:"conn"`  // 连接 uuid 字符串；空=该环节未配置
	Model string `json:"model"` // 可空
}

// StageBindings 是环节到绑定的映射（key ∈ write/review），存于 user_story_llm_configs.bindings(JSON 文本)。
type StageBindings map[string]StageBinding

// parseBindings 解析 bindings JSON；坏数据/空回退空映射。
func parseBindings(raw string) StageBindings {
	b := StageBindings{}
	if raw == "" {
		return b
	}
	_ = json.Unmarshal([]byte(raw), &b)
	return b
}

// llmStore 是 resolver 依赖的窄接口（*repository.LLMRepository 已满足）。
// 收窄依赖便于用 fake 单测优先级链，免引 DB。
type llmStore interface {
	FindConnByID(ctx context.Context, id uuid.UUID) (*model.LLMConnection, error)
	FindPlatform(ctx context.Context, stage string) (*model.PlatformLLMSetting, error)
	FindStoryConfig(ctx context.Context, userID, storyID uuid.UUID) (*model.UserStoryLLMConfig, error)
}

// LLMResolver 按环节解析出有效的下发配置（AgentLLMConfig）。
// 连接/key 皆用户级；游玩配置按「作品级」——每玩家在每作品各配各的模型。
// 命中用户/平台时解密 key；解密失败或连接失效则跳到下一档，不硬报错。
type LLMResolver struct {
	llm    llmStore
	encKey string
}

func NewLLMResolver(llm llmStore, encKey string) *LLMResolver {
	return &LLMResolver{llm: llm, encKey: encKey}
}

// ResolveForPlay 解析某玩家在某作品下某环节（write/review）的配置。
// 优先级：作品级配置（玩家选的连接+模型）→ 平台该环节设置 → nil（agent 回退 .env）。
func (r *LLMResolver) ResolveForPlay(ctx context.Context, userID, storyID uuid.UUID, stage string) (*AgentLLMConfig, error) {
	if userID != uuid.Nil && storyID != uuid.Nil {
		if sc, err := r.llm.FindStoryConfig(ctx, userID, storyID); err == nil && sc != nil {
			b := parseBindings(sc.Bindings)[stage]
			if b.Conn != "" {
				if connID, err := uuid.Parse(b.Conn); err == nil {
					if cfg := r.fromConnection(ctx, userID, connID, b.Model); cfg != nil {
						return cfg, nil
					}
				}
			}
		}
	}
	return r.platformOrNil(ctx, stage), nil
}

// ResolveForAssist 解析创作者在创作侧（world 环节）的配置。
// 优先级：编辑器显式覆盖连接 → 平台 world 设置 → nil。（创作侧无作品级配置，连接由编辑器现选。）
func (r *LLMResolver) ResolveForAssist(ctx context.Context, userID uuid.UUID, overrideConnID *uuid.UUID) (*AgentLLMConfig, error) {
	if overrideConnID != nil && userID != uuid.Nil {
		if cfg := r.fromConnection(ctx, userID, *overrideConnID, ""); cfg != nil {
			return cfg, nil
		}
	}
	return r.platformOrNil(ctx, StageWorld), nil
}

// platformOrNil 取某环节平台设置并解密；无则返回 nil（agent 回退 .env）。
func (r *LLMResolver) platformOrNil(ctx context.Context, stage string) *AgentLLMConfig {
	if ps, err := r.llm.FindPlatform(ctx, stage); err == nil && ps != nil {
		if key, err := pkg.Decrypt(ps.APIKeyCipher, r.encKey); err == nil && key != "" {
			return &AgentLLMConfig{Provider: ps.Provider, BaseURL: ps.BaseURL, APIKey: key, Model: ps.Model}
		}
	}
	return nil
}

// fromConnection 从一条连接构造下发配置：校验归属 + 解密 key（失败/无 key 返回 nil）。
// modelOverride 非空时覆盖连接的 DefaultModel（环节级模型粒度）。
func (r *LLMResolver) fromConnection(ctx context.Context, userID, connID uuid.UUID, modelOverride string) *AgentLLMConfig {
	conn, err := r.llm.FindConnByID(ctx, connID)
	if err != nil || conn == nil || conn.UserID != userID {
		return nil
	}
	key, err := pkg.Decrypt(conn.APIKeyCipher, r.encKey)
	if err != nil || key == "" {
		return nil
	}
	model := modelOverride
	if model == "" {
		model = conn.DefaultModel
	}
	return &AgentLLMConfig{Provider: conn.Provider, BaseURL: conn.BaseURL, APIKey: key, Model: model}
}
