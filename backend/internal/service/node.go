package service

import (
	"backend/internal/model"
	"backend/internal/repository"
	"context"

	"github.com/google/uuid"
)

type NodeService struct {
	repo *repository.NodeRepository
}

func NewNodeService(repo *repository.NodeRepository) *NodeService {
	return &NodeService{repo: repo}
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

func (s *NodeService) Update(nodeID uuid.UUID, input *NodeCreateInput) (*model.NodeResponse, error) {
	ctx := context.Background()

	node, err := s.repo.FindByID(ctx, nodeID)
	if err != nil {
		return nil, err
	}
	if node == nil {
		return nil, nil
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

func (s *NodeService) Delete(nodeID uuid.UUID) error {
	return s.repo.Delete(context.Background(), nodeID)
}
