package service

import (
	"context"

	"backend/internal/model"

	"github.com/google/uuid"
)

// PlayService 的依赖替身点。
//
// ⚠️ **不要把这些接口放进 ports.go。** 那个文件是**跨模块接缝**（`StoryReader` /
// `StoryCounter` 是 play 读写 story 的唯一入口，将来拆服务就沿它切）；下面这几个是
// **同模块内为可测性**开的替身点，性质不同。混在一起会让 ports.go 的含义糊掉。
//
// 「窄」= 只包含 `PlayService` 自己用到的方法，不是只包含开场路径用到的——具体仓储上
// 其余的方法（NodeRepository.Create/Update/Delete/EnsureRootIndex 等）不进接口。
// ⚠️ 统计口径是 PlayService 自己的方法体；按字段名在整个 service 包里 grep 会串到
// LLMService（它也有个叫 resolver 的字段）。
//
// 具体类型天然满足这些签名（鸭子类型），main.go 的装配一行不用改。收窄的唯一目的是
// 让 play_opening_test.go 能注入替身，断言「AI 只调一次、扣费只调一次」——按原来的
// 具体类型，那三条断言一条都写不出来。

// sessionStore 是 PlayService 对 *repository.PlaySessionRepository 的调用面。
type sessionStore interface {
	Create(ctx context.Context, s *model.PlaySession) error
	FindByID(ctx context.Context, id uuid.UUID) (*model.PlaySession, error)
	FindByPlayerID(ctx context.Context, playerID uuid.UUID) ([]model.PlaySession, error)
	Update(ctx context.Context, s *model.PlaySession) error
	// CreateNodeAndUpdateSession 把「插入节点」与「更新会话」放进同一个事务。
	// 这是 play 跨表写的唯一入口，不存在拿裸连接自己拼的路径。
	CreateNodeAndUpdateSession(ctx context.Context, node *model.StoryNode, s *model.PlaySession) error
	DeleteSessionCascade(ctx context.Context, sessionID uuid.UUID) error
}

// nodeStore 是 PlayService 对 *repository.NodeRepository 的调用面。
// 树查询走 Postgres 递归 CTE（FindPath），不在 Go 里递归。
type nodeStore interface {
	FindByID(ctx context.Context, id uuid.UUID) (*model.StoryNode, error)
	FindBySessionID(ctx context.Context, sessionID uuid.UUID) ([]model.StoryNode, error)
	FindChildren(ctx context.Context, nodeID uuid.UUID) ([]model.StoryNode, error)
	FindPath(ctx context.Context, nodeID uuid.UUID) ([]model.StoryNode, error)
}

// storyAI 是 PlayService 对 *AgentClient 的调用面。
// 两个 Stream 方法把 onDelta/onRevise 回调透到 SSE 上，替身据此模拟逐字流。
type storyAI interface {
	StartStoryStream(
		ctx context.Context, world WorldConfig, initialState map[string]any,
		revealedAttrs []string, write, review *AgentLLMConfig,
		onDelta func(string), onRevise func(),
	) (*AIResult, error)
	ContinueStream(
		ctx context.Context,
		world WorldConfig, history []PathStep, currentState map[string]any, choice string,
		revealedAttrs []string, write, review *AgentLLMConfig,
		onDelta func(string), onRevise func(),
	) (*AIResult, error)
	CompleteOpening(
		ctx context.Context, world WorldConfig, initialState map[string]any,
		content string, write *AgentLLMConfig,
	) (*AIResult, error)
	CheckMerge(ctx context.Context, newChoice, newContent string, candidates []MergeCandidate, judge *AgentLLMConfig) (int, error)
}

// playLLMResolver 是 PlayService 对 *LLMResolver 的调用面（BYOK 分环节解析）。
type playLLMResolver interface {
	ResolveForPlay(ctx context.Context, userID, storyID uuid.UUID, stage string) (*AgentLLMConfig, error)
	ReviewEnabled(ctx context.Context, userID, storyID uuid.UUID) (bool, error)
}

// creditCharger 是 PlayService 对 *CreditService 的调用面。
// 事后扣费、无返回值：花多少 token 只有调用完才知道，扣到 0 为止不预扣。
type creditCharger interface {
	ChargeAll(
		ctx context.Context, userID uuid.UUID, storyID *uuid.UUID,
		write, review *AgentLLMConfig, u StageUsages,
	)
}
