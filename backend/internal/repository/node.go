package repository

import (
	"context"
	"errors"

	"backend/internal/model"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type NodeRepository struct {
	db *gorm.DB
}

func NewNodeRepository(db *gorm.DB) *NodeRepository {
	return &NodeRepository{db: db}
}

func (r *NodeRepository) FindBySessionID(ctx context.Context, sessionID uuid.UUID) ([]model.StoryNode, error) {
	var nodes []model.StoryNode
	err := r.db.WithContext(ctx).Where("session_id = ?", sessionID).Order("depth, created_at").Find(&nodes).Error
	return nodes, err
}

func (r *NodeRepository) FindChildren(ctx context.Context, nodeID uuid.UUID) ([]model.StoryNode, error) {
	var nodes []model.StoryNode
	err := r.db.WithContext(ctx).Where("parent_id = ?", nodeID).Order("created_at").Find(&nodes).Error
	return nodes, err
}

func (r *NodeRepository) FindByID(ctx context.Context, id uuid.UUID) (*model.StoryNode, error) {
	var node model.StoryNode
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&node).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &node, err
}

// FindPath 用递归 CTE 沿 parent_id 从指定节点向上回溯到根，
// 返回按 depth 升序（根→当前）排列的完整路径，供构建 AI 上下文。
func (r *NodeRepository) FindPath(ctx context.Context, nodeID uuid.UUID) ([]model.StoryNode, error) {
	var nodes []model.StoryNode
	const q = `
WITH RECURSIVE path AS (
    SELECT * FROM story_nodes WHERE id = ?
    UNION ALL
    SELECT n.* FROM story_nodes n
    INNER JOIN path p ON n.id = p.parent_id
)
SELECT * FROM path ORDER BY depth ASC`
	err := r.db.WithContext(ctx).Raw(q, nodeID).Scan(&nodes).Error
	return nodes, err
}

func (r *NodeRepository) Create(ctx context.Context, node *model.StoryNode) error {
	return r.db.WithContext(ctx).Create(node).Error
}

func (r *NodeRepository) Update(ctx context.Context, node *model.StoryNode) error {
	return r.db.WithContext(ctx).Save(node).Error
}

func (r *NodeRepository) Delete(ctx context.Context, id uuid.UUID) error {
	return r.db.WithContext(ctx).Delete(&model.StoryNode{}, "id = ?", id).Error
}

// RootIdxName 是「一个会话一个根节点」那条部分唯一索引的名字。
//
// ⚠️ **建索引与识别冲突必须用同一个常量。** 服务层把 23505 翻译成「开场已存在」的幂等
// 成功时要连约束名一起判（service.isUniqueViolation）——只匹配错误码的话，将来任何一条
// 唯一约束冲突都会被当成「根节点已存在」吞掉，把真实错误埋了。
const RootIdxName = "uniq_root_per_session"

// EnsureRootIndex 建「一个会话只能有一个根节点」的部分唯一索引。
//
// ⚠️ **这个索引不会由 AutoMigrate 产生**：GORM 的模型标签表达不了 `WHERE parent_id IS NULL`
// 这个谓词，model/node.go 上的 index tag 只是普通索引。必须显式执行，且要在 AutoMigrate
// **之后**（表得先存在）。
//
// 它是跨实例、跨重启的兜底——进程内单飞只在单实例内有效。
func (r *NodeRepository) EnsureRootIndex(ctx context.Context) error {
	return r.db.WithContext(ctx).Exec(
		`CREATE UNIQUE INDEX IF NOT EXISTS ` + RootIdxName +
			` ON story_nodes (session_id) WHERE parent_id IS NULL`).Error
}
