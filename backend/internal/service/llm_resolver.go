package service

import (
	"context"
	"encoding/json"
	"log"
	"strings"

	"backend/internal/model"
	"backend/pkg"

	"github.com/google/uuid"
)

// 流水与用户绑定的环节标识。平台兜底不分环节；这些常量只用于
// 「用户在哪个环节绑了哪条连接」和用量流水的 stage 字段。
const (
	StageWrite  = "write"
	StageReview = "review"

	StageAssistWorld    = "assist_world"
	StageAssistOpening  = "assist_opening"
	StageAssistPolish   = "assist_polish"
	StageAssistBranches = "assist_branches"
)

// PlayStages 是游玩相关、可在作品级配置的环节。
var PlayStages = map[string]bool{StageWrite: true, StageReview: true}

// StageBinding 是「某环节 → 用哪条连接的哪个模型」。
// **Conn 非空时 Model 必填**：连接不再持有默认模型，没有可回退的东西。
type StageBinding struct {
	Conn  string `json:"conn"`  // 连接 uuid 字符串；空=该环节走平台档
	Model string `json:"model"` // Conn 非空时必填
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
	FindPlatform(ctx context.Context) (*model.PlatformLLMSetting, error)
	FindStoryConfig(ctx context.Context, userID, storyID uuid.UUID) (*model.UserStoryLLMConfig, error)
	FindAssistConfig(ctx context.Context, userID uuid.UUID) (*model.UserAssistLLMConfig, error)
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
// 优先级：作品级配置（玩家选的连接+模型）→ 平台兜底（需额度）→ nil（调用方须报错）。
// stage 只决定读用户的哪个绑定；平台兜底全局一条，与环节无关。
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
	return r.platformIfCredit(ctx, userID)
}

// ResolveForAssist 解析创作者在创作侧的配置。
// 优先级：**账号级创作辅助配置** → 平台兜底 → nil。
//
// 配置来自设置页（user_assist_llm_configs），不由请求体携带：编辑器里曾有一个临时下拉，
// 但它只在第 1 段出现、也从不持久，作者直奔第 4 段用「生成开场 / 精品润色」时既看不到
// 也改不了。入口收敛到设置页后，客户端不再能指定用哪条连接，少一个可注入的入参。
func (r *LLMResolver) ResolveForAssist(ctx context.Context, userID uuid.UUID) (*AgentLLMConfig, error) {
	if userID != uuid.Nil {
		ac, err := r.llm.FindAssistConfig(ctx, userID)
		if err != nil {
			return nil, err // 存储故障上抛，别伪装成「没配置」
		}
		if ac != nil && ac.ConnID != nil {
			cfg, err := r.fromConnection(ctx, userID, *ac.ConnID, ac.Model)
			if err != nil {
				return nil, err
			}
			if cfg != nil {
				return cfg, nil
			}
		}
	}
	return r.platformIfCredit(ctx, userID)
}

// platformIfCredit 取平台兜底设置并解密，**但只在该用户还有额度时才给**。
// 无设置/解密失败/匿名/余额耗尽 → nil，由调用方转成明确错误。
//
// 匿名（uuid.Nil）一律不给：额度挂在账号上。这条如今是防御性的——`/play/*` 全组
// AuthRequired，匿名请求到不了这里；历史上匿名玩家共用同一个 guest id（handoff
// §9.2），给了等于让第一个匿名访客花光所有人的额度。
func (r *LLMResolver) platformIfCredit(ctx context.Context, userID uuid.UUID) (*AgentLLMConfig, error) {
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
	ps, err := r.llm.FindPlatform(ctx)
	if err != nil {
		return nil, err
	}
	if ps == nil {
		return nil, nil // admin 没配平台兜底，是确定的配置缺失
	}
	key, err := pkg.Decrypt(ps.APIKeyCipher, r.encKey)
	if err != nil || key == "" {
		// 仍然下落（对调用方而言这一档就是不可用），但**必须留痕**：
		// 静默下落会把"服务端密钥配错"伪装成"用户没配模型"，线上无从排查。
		if ps.APIKeyCipher != "" {
			log.Printf("llm: 平台兜底 key 解不开（ENCRYPTION_KEY 与密文不匹配？）: %v", err)
		}
		return nil, nil
	}
	return &AgentLLMConfig{
		Provider: ps.Provider, BaseURL: ps.BaseURL, APIKey: key, Model: ps.Model,
		Source: SourcePlatform, PriceInPerMTok: ps.PriceInPerMTok, PriceOutPerMTok: ps.PriceOutPerMTok,
		PriceCacheInPerMTok: ps.PriceCacheInPerMTok,
	}, nil
}

// fromConnection 从一条连接 + 一个**显式指定的模型**构造下发配置：
// 校验归属 + 解密 key（失败/无 key 返回 nil）。
//
// model 为空同样返回 nil：连接不再有默认模型，"选了连接没选模型"是确定的配置问题，
// 与"连接已删 / key 解不开"同类，回落下一档而不是硬报错。
func (r *LLMResolver) fromConnection(ctx context.Context, userID, connID uuid.UUID, model string) (*AgentLLMConfig, error) {
	if strings.TrimSpace(model) == "" {
		return nil, nil
	}
	conn, err := r.llm.FindConnByID(ctx, connID)
	if err != nil {
		return nil, err
	}
	if conn == nil || conn.UserID != userID {
		return nil, nil // 连接已删或不属于该用户：确定的配置问题，回退下一档
	}
	key, err := pkg.Decrypt(conn.APIKeyCipher, r.encKey)
	if err != nil || key == "" {
		if conn.APIKeyCipher != "" {
			log.Printf("llm: 连接 key 解不开 conn=%s（ENCRYPTION_KEY 与密文不匹配？）: %v", connID, err)
		}
		return nil, nil
	}
	// Source=user：玩家自己的 key，不动平台额度，也不记用量流水。
	return &AgentLLMConfig{
		Provider: conn.Provider, BaseURL: conn.BaseURL, APIKey: key, Model: strings.TrimSpace(model),
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

// PlatformAvailable 回答「平台兜底档现在可不可选」：有额度 + admin 配了 key。
// 供前端把「平台」这一档显示成可选或禁用（并说明原因）。
// 纯展示探针，查库出错就当不可选——这里不会替玩家花钱，无需上抛。
func (r *LLMResolver) PlatformAvailable(ctx context.Context, userID uuid.UUID) bool {
	cfg, err := r.platformIfCredit(ctx, userID)
	return err == nil && cfg != nil
}

// PlatformOption 是平台兜底档的对外形态：能不能用 + 预设的是哪个模型。
type PlatformOption struct {
	Ready bool   `json:"ready"`
	Model string `json:"model"`
}

// PlatformOptionFor 回平台兜底档的可用性与预设模型名。
// 模型名即便不可用也回：玩家该看见自己错过的是什么，而不是一个空白的禁用框。
func (r *LLMResolver) PlatformOptionFor(ctx context.Context, userID uuid.UUID) PlatformOption {
	ps, err := r.llm.FindPlatform(ctx)
	if err != nil || ps == nil {
		return PlatformOption{}
	}
	return PlatformOption{Ready: r.PlatformAvailable(ctx, userID), Model: ps.Model}
}
