package service

import (
	"backend/internal/model"
	"backend/internal/repository"
	"backend/pkg"
	"context"

	"github.com/google/uuid"
)

type NodeService struct {
	repo    *repository.NodeRepository
	stories StoryReader // 经 node.StoryID → Story.CreatorID 做归属校验（跨模块只读走窄接口）
}

func NewNodeService(repo *repository.NodeRepository, stories StoryReader) *NodeService {
	return &NodeService{repo: repo, stories: stories}
}

// checkNodeOwner 校验某节点所属作品的创作者是否为调用者，否则 403 / 资源缺失时 404。
func (s *NodeService) checkNodeOwner(ctx context.Context, node *model.StoryNode, userID uuid.UUID) error {
	story, err := s.stories.FindByID(ctx, node.StoryID)
	if err != nil {
		return err
	}
	if story == nil {
		return pkg.NotFound("story not found")
	}
	return requireOwner(story.CreatorID, userID)
}

type NodeCreateInput struct {
	ParentID   *uuid.UUID `json:"parent_id"`
	ChoiceText *string    `json:"choice_text"`
	Content    string     `json:"content"`
	IsEnding   bool       `json:"is_ending"`
}

func (s *NodeService) Create(storyID uuid.UUID, sessionID uuid.UUID, input *NodeCreateInput) (*model.NodeResponse, error) {
	ctx := context.Background()

	depth := 0
	if input.ParentID != nil {
		parent, err := s.repo.FindByID(ctx, *input.ParentID)
		if err != nil {
			return nil, err
		}
		if parent != nil {
			depth = parent.Depth + 1
		}
	}

	node := &model.StoryNode{
		StoryID:    storyID,
		SessionID:  sessionID,
		ParentID:   input.ParentID,
		ChoiceText: input.ChoiceText,
		Content:    input.Content,
		Depth:      depth,
		IsEnding:   input.IsEnding,
	}

	if err := s.repo.Create(ctx, node); err != nil {
		return nil, err
	}

	return node.ToResponse(), nil
}

func (s *NodeService) GetChildren(nodeID uuid.UUID) ([]model.NodeResponse, error) {
	ctx := context.Background()

	nodes, err := s.repo.FindChildren(ctx, nodeID)
	if err != nil {
		return nil, err
	}

	responses := make([]model.NodeResponse, 0, len(nodes))
	for i := range nodes {
		responses = append(responses, *nodes[i].ToResponse())
	}

	return responses, nil
}

func (s *NodeService) Update(userID, nodeID uuid.UUID, input *NodeCreateInput) (*model.NodeResponse, error) {
	ctx := context.Background()

	node, err := s.repo.FindByID(ctx, nodeID)
	if err != nil {
		return nil, err
	}
	if node == nil {
		return nil, nil
	}
	if err := s.checkNodeOwner(ctx, node, userID); err != nil {
		return nil, err
	}

	if input.ChoiceText != nil {
		node.ChoiceText = input.ChoiceText
	}
	if input.Content != "" {
		node.Content = input.Content
	}
	node.IsEnding = input.IsEnding

	if err := s.repo.Update(ctx, node); err != nil {
		return nil, err
	}

	return node.ToResponse(), nil
}

func (s *NodeService) Delete(userID, nodeID uuid.UUID) error {
	ctx := context.Background()
	node, err := s.repo.FindByID(ctx, nodeID)
	if err != nil {
		return err
	}
	if node == nil {
		return pkg.NotFound("node not found")
	}
	if err := s.checkNodeOwner(ctx, node, userID); err != nil {
		return err
	}
	return s.repo.Delete(ctx, nodeID)
}
