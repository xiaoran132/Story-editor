package service

import (
	"context"

	"backend/internal/model"

	"github.com/google/uuid"
)

// StoryReader 是 play / node 等模块跨领域读取 story 的窄接口——模块间唯一只读入口。
// 约定：模块之间禁止直接依赖对方的 repository，只能依赖这样的窄接口。
// *repository.StoryRepository 已天然满足此签名；将来 story 拆为独立服务时，
// 只需把实现换成 RPC 客户端，依赖方（play/node）代码零改动。这是保留的拆分接缝。
type StoryReader interface {
	FindByID(ctx context.Context, id uuid.UUID) (*model.Story, error)
}
