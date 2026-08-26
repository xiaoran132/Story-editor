package service

import (
	"backend/pkg"

	"github.com/google/uuid"
)

// requireOwner 统一资源归属校验：owner 必须等于 caller，否则返回 403。
// 用于资源确定存在、越权即应显式拒绝的场景（如 play 会话、node 归属修复）。
func requireOwner(ownerID, callerID uuid.UUID) error {
	if ownerID != callerID {
		return pkg.Forbidden("无权访问该资源")
	}
	return nil
}

// ownerOrNotFound 是归属校验的另一变体：属主不符时返回 404、不泄露资源是否存在。
// 对应 story/llm 现有语义（本次不强制迁移，供新代码按需复用）。
func ownerOrNotFound(ownerID, callerID uuid.UUID) error {
	if ownerID != callerID {
		return pkg.NotFound("内容不存在")
	}
	return nil
}
