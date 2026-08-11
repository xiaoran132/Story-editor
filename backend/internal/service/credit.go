package service

import (
	"context"
	"log"
	"math"

	"backend/internal/model"

	"github.com/google/uuid"
)

// 平台额度：注册赠 1 元（model.User.CreditMicroCNY 的列默认值），按真实 token 用量
// × 平台设置里的单价折算扣减。用尽后必须配自己的 LLM 连接才能继续玩。
//
// 为什么是"事后扣费"：花多少 token 只有调用完才知道，事前无法预扣准确金额。
// 代价是最后一回合可能略微透支（扣到 0 为止，见 repository.ChargeCredit）。
// 用一次调用的余额检查换取一个精确的预扣系统，在 0 用户阶段不值当。

// MicroPerCNY 是 1 元对应的微元数。整数存储避免浮点累加误差。
const MicroPerCNY = 1_000_000

// TokenUsage 是 agent 回传的单环节 token 用量（与 agent schemas.StageUsage 对齐）。
type TokenUsage struct {
	PromptTokens     int  `json:"prompt_tokens"`
	CompletionTokens int  `json:"completion_tokens"`
	Estimated        bool `json:"estimated"` // 端点没回 usage，数字是按字符估的
}

// StageUsages 是一次生成里按环节分开的用量（write/review 可能是不同模型、不同单价）。
type StageUsages struct {
	Write  TokenUsage `json:"write"`
	Review TokenUsage `json:"review"`
}

// creditStore 是额度相关的窄接口（*repository.LLMRepository 已满足）。
type creditStore interface {
	GetCredit(ctx context.Context, userID uuid.UUID) (int64, error)
	ChargeCredit(ctx context.Context, log *model.LLMUsageLog) error
}

// CreditService 管平台额度的查询与扣减。
type CreditService struct {
	store creditStore
}

func NewCreditService(store creditStore) *CreditService {
	return &CreditService{store: store}
}

// Balance 返回某用户的额度余额（微元）。匿名（uuid.Nil）恒为 0——额度挂在账号上。
func (s *CreditService) Balance(ctx context.Context, userID uuid.UUID) int64 {
	if s == nil || userID == uuid.Nil {
		return 0
	}
	credit, err := s.store.GetCredit(ctx, userID)
	if err != nil {
		return 0 // 读不到就当没有：宁可拦住玩家，也不要白送一轮生成
	}
	return credit
}

// costMicro 按「元/百万 token」的单价把 token 数折算成微元，向上取整。
//
// 向上取整而非四舍五入：单次调用几百 token 时四舍五入常年归零，1 元额度就成了无限。
func costMicro(u TokenUsage, priceInPerMTok, priceOutPerMTok float64) int64 {
	cny := (float64(u.PromptTokens)*priceInPerMTok + float64(u.CompletionTokens)*priceOutPerMTok) / 1_000_000
	micro := math.Ceil(cny * MicroPerCNY)
	if micro < 0 || math.IsNaN(micro) || math.IsInf(micro, 0) {
		return 0
	}
	return int64(micro)
}

// Charge 为一次「用了平台额度」的调用扣费并记流水。
//
// 只在该环节确实走了平台档时调用（cfg.Source == SourcePlatform）；玩家用自己的 key
// 时不该扣我们的额度，也不该被我们记录用量。
//
// 扣费失败只记日志、不向上报错：token 已经烧掉了，此时让玩家的回合失败于事无补——
// 宁可漏记一笔，也不要把一次成功的生成变成一个报错。
func (s *CreditService) Charge(
	ctx context.Context, userID uuid.UUID, storyID *uuid.UUID,
	stage string, cfg *AgentLLMConfig, u TokenUsage,
) {
	if s == nil || cfg == nil || cfg.Source != SourcePlatform || userID == uuid.Nil {
		return
	}
	if u.PromptTokens == 0 && u.CompletionTokens == 0 {
		return
	}
	cost := costMicro(u, cfg.PriceInPerMTok, cfg.PriceOutPerMTok)
	if err := s.store.ChargeCredit(ctx, &model.LLMUsageLog{
		UserID:           userID,
		StoryID:          storyID,
		Stage:            stage,
		Model:            cfg.Model,
		PromptTokens:     u.PromptTokens,
		CompletionTokens: u.CompletionTokens,
		CostMicroCNY:     cost,
		Estimated:        u.Estimated,
	}); err != nil {
		log.Printf("credit charge failed user=%s stage=%s cost_micro=%d: %v", userID, stage, cost, err)
	}
}

// ChargeAll 按环节扣一次生成的全部花费。
func (s *CreditService) ChargeAll(
	ctx context.Context, userID uuid.UUID, storyID *uuid.UUID,
	write, review *AgentLLMConfig, u StageUsages,
) {
	s.Charge(ctx, userID, storyID, StageWrite, write, u.Write)
	s.Charge(ctx, userID, storyID, StageReview, review, u.Review)
}
