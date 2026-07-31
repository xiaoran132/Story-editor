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
