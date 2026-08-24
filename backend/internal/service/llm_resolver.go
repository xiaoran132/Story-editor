package service

import (
	"context"
	"encoding/json"

	"backend/internal/model"
	"backend/pkg"

	"github.com/google/uuid"
)

// 模型配置环节：创作辅助继续共用 world，不新增平台模型设置。
const (
	StageWrite  = "write"
	StageReview = "review"
	StageWorld  = "world"

	StageAssistWorld    = "assist_world"
	StageAssistOpening  = "assist_opening"
	StageAssistPolish   = "assist_polish"
	StageAssistBranches = "assist_branches"
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
	GetCredit(ctx context.Context, userID uuid.UUID) (int64, error)
}

// LLMResolver 按环节解析出有效的下发配置（AgentLLMConfig）。
//
// 优先级：**作品级用户连接 → 平台档（需有额度） → nil**。
// 返回 nil 时调用方必须**明确失败**（pkg.CodeNoLLMConfig）——agent 已不持有任何
// 默认凭据，那层看不见、无法限额的 .env 兜底已被删除。
//
// 平台档要花注册赠送的 1 元额度（见 credit.go）；余额 ≤ 0 或匿名调用不给平台档。
// 命中用户/平台时解密 key；解密失败或连接失效则跳到下一档，不硬报错。
type LLMResolver struct {
	llm    llmStore
	encKey string
}

func NewLLMResolver(llm llmStore, encKey string) *LLMResolver {
	return &LLMResolver{llm: llm, encKey: encKey}
}

// ResolveForPlay 解析某玩家在某作品下某环节（write/review）的配置。
// 优先级：作品级配置（玩家选的连接+模型）→ 平台该环节设置（需额度）→ nil（调用方须报错）。
//
// **存储故障一律上抛，不伪装成「没配置」**：查库失败和用户真没配置是两回事，
// 前者静默降级到平台档 = 拿平台的钱替一次数据库抖动买单，且排障时看到的是
// 「未配置模型」这种指向完全错误的提示。只有「查到但没绑定 / 连接不属于该用户 /
// 密钥解不开」这类**确定的配置问题**才继续往下一档回退。
func (r *LLMResolver) ResolveForPlay(ctx context.Context, userID, storyID uuid.UUID, stage string) (*AgentLLMConfig, error) {
	if userID != uuid.Nil && storyID != uuid.Nil {
		sc, err := r.llm.FindStoryConfig(ctx, userID, storyID)
		if err != nil {
			return nil, err
		}
		if sc != nil {
			b := parseBindings(sc.Bindings)[stage]
			if b.Conn != "" {
				if connID, err := uuid.Parse(b.Conn); err == nil {
					cfg, err := r.fromConnection(ctx, userID, connID, b.Model)
					if err != nil {
						return nil, err
					}
					if cfg != nil {
						return cfg, nil
					}
				}
			}
		}
	}
	return r.platformIfCredit(ctx, userID, stage)
}

// ResolveForAssist 解析创作者在创作侧（world 环节）的配置。
// 优先级：编辑器显式覆盖连接 → 平台 world 设置 → nil。（创作侧无作品级配置，连接由编辑器现选。）
func (r *LLMResolver) ResolveForAssist(ctx context.Context, userID uuid.UUID, overrideConnID *uuid.UUID) (*AgentLLMConfig, error) {
	if overrideConnID != nil && userID != uuid.Nil {
		cfg, err := r.fromConnection(ctx, userID, *overrideConnID, "")
		if err != nil {
			return nil, err
		}
		if cfg != nil {
			return cfg, nil
		}
	}
	return r.platformIfCredit(ctx, userID, StageWorld)
}

// platformIfCredit 取某环节平台设置并解密，**但只在该用户还有额度时才给**。
// 无设置/解密失败/匿名/余额耗尽 → nil，由调用方转成明确错误。
//
// 匿名（uuid.Nil）一律不给：额度挂在账号上。这条如今是防御性的——`/play/*` 全组
// AuthRequired，匿名请求到不了这里；历史上匿名玩家共用同一个 guest id（handoff
// §9.2），给了等于让第一个匿名访客花光所有人的额度。
func (r *LLMResolver) platformIfCredit(ctx context.Context, userID uuid.UUID, stage string) (*AgentLLMConfig, error) {
	if userID == uuid.Nil {
		return nil, nil
	}
	credit, err := r.llm.GetCredit(ctx, userID)
	if err != nil {
		return nil, err // 查不到余额 ≠ 余额为零，不能当「额度耗尽」处理
	}
	if credit <= 0 {
		return nil, nil
	}
	ps, err := r.llm.FindPlatform(ctx, stage)
	if err != nil {
		return nil, err
	}
	if ps == nil {
		return nil, nil // admin 没配这个环节，是确定的配置缺失
	}
	key, err := pkg.Decrypt(ps.APIKeyCipher, r.encKey)
	if err != nil || key == "" {
		return nil, nil // 解密失败属配置问题（换过 ENCRYPTION_KEY），不是存储故障
	}
	return &AgentLLMConfig{
		Provider: ps.Provider, BaseURL: ps.BaseURL, APIKey: key, Model: ps.Model,
		Source: SourcePlatform, PriceInPerMTok: ps.PriceInPerMTok, PriceOutPerMTok: ps.PriceOutPerMTok,
	}, nil
}

// fromConnection 从一条连接构造下发配置：校验归属 + 解密 key（失败/无 key 返回 nil）。
// modelOverride 非空时覆盖连接的 DefaultModel（环节级模型粒度）。
func (r *LLMResolver) fromConnection(ctx context.Context, userID, connID uuid.UUID, modelOverride string) (*AgentLLMConfig, error) {
	conn, err := r.llm.FindConnByID(ctx, connID)
	if err != nil {
		return nil, err
	}
	if conn == nil || conn.UserID != userID {
		return nil, nil // 连接已删或不属于该用户：确定的配置问题，回退下一档
	}
	key, err := pkg.Decrypt(conn.APIKeyCipher, r.encKey)
	if err != nil || key == "" {
		return nil, nil
	}
	model := modelOverride
	if model == "" {
		model = conn.DefaultModel
	}
	// Source=user：玩家自己的 key，不动平台额度，也不记用量流水。
	return &AgentLLMConfig{
		Provider: conn.Provider, BaseURL: conn.BaseURL, APIKey: key, Model: model,
		Source: SourceUser,
	}, nil
}

// ReviewEnabled 读某玩家在某作品的「质量审校」开关（默认关）。
//
// 默认关是刻意的：开启要求单独配 review 的连接，若默认开，新玩家配了 write 还是玩不了。
// 代价是默认质量下限低于以前（以前人人都过审校，真实拒绝率约 18%），
// 这个权衡在前端开关旁写明。
// 存储故障同样上抛：静默返回 false 会让玩家以为审校在生效，而实际整段被跳过。
func (r *LLMResolver) ReviewEnabled(ctx context.Context, userID, storyID uuid.UUID) (bool, error) {
	if userID == uuid.Nil || storyID == uuid.Nil {
		return false, nil
	}
	sc, err := r.llm.FindStoryConfig(ctx, userID, storyID)
	if err != nil {
		return false, err
	}
	if sc == nil {
		return false, nil
	}
	return sc.ReviewEnabled, nil
}

// PlatformAvailable 回答「平台档现在可不可选」：有额度 + admin 配了该环节的 key。
// 供前端把「平台」这一档显示成可选或禁用（并说明原因）。
// 纯展示探针，查库出错就当不可选——这里不会替玩家花钱，无需上抛。
func (r *LLMResolver) PlatformAvailable(ctx context.Context, userID uuid.UUID, stage string) bool {
	cfg, err := r.platformIfCredit(ctx, userID, stage)
	return err == nil && cfg != nil
}

// PlatformOption 是平台档在某环节的对外形态：能不能用 + 预设的是哪个模型。
type PlatformOption struct {
	Ready bool   `json:"ready"`
	Model string `json:"model"`
}

// PlatformOptionFor 按环节回平台档的可用性与预设模型名。
//
// 可用性**按环节各算各的**：admin 的平台设置本来就是每环节一行，只算 write
// 再套用到 review，会把「review 没配 key」显示成可选。
// 模型名即便不可用也回：玩家该看见自己错过的是什么，而不是一个空白的禁用框。
func (r *LLMResolver) PlatformOptionFor(ctx context.Context, userID uuid.UUID, stage string) PlatformOption {
	ps, err := r.llm.FindPlatform(ctx, stage)
	if err != nil || ps == nil {
		return PlatformOption{}
	}
	return PlatformOption{Ready: r.PlatformAvailable(ctx, userID, stage), Model: ps.Model}
}
