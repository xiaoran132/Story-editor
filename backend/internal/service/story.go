package service

import (
	"backend/internal/model"
	"backend/internal/repository"
	"context"

	"github.com/google/uuid"
)

type StoryService struct {
	repo *repository.StoryRepository
}

func NewStoryService(repo *repository.StoryRepository) *StoryService {
	return &StoryService{repo: repo}
}

type StoryCreateInput struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	CoverURL    string `json:"cover_url"`
}

func (s *StoryService) Create(creatorID uuid.UUID, input *StoryCreateInput) (*model.StoryResponse, error) {
	ctx := context.Background()

	story := &model.Story{
		CreatorID:   creatorID,
		Title:       input.Title,
		Description: input.Description,
		CoverURL:    input.CoverURL,
		Status:      "draft",
	}

	if err := s.repo.Create(ctx, story); err != nil {
		return nil, err
	}

	return story.ToResponse(), nil
}

func (s *StoryService) Get(storyID uuid.UUID) (*model.StoryResponse, error) {
	ctx := context.Background()

	story, err := s.repo.FindByID(ctx, storyID)
	if err != nil {
		return nil, err
	}
	if story == nil {
		return nil, nil
	}

	return story.ToResponse(), nil
}

func (s *StoryService) Update(storyID, userID uuid.UUID, input *StoryCreateInput) (*model.StoryResponse, error) {
	ctx := context.Background()

	story, err := s.repo.FindByID(ctx, storyID)
	if err != nil {
		return nil, err
	}
	if story == nil {
		return nil, nil
	}
	if story.CreatorID != userID {
		return nil, nil
	}

	if input.Title != "" {
		story.Title = input.Title
	}
	if input.Description != "" {
		story.Description = input.Description
	}
	if input.CoverURL != "" {
		story.CoverURL = input.CoverURL
	}

	if err := s.repo.Update(ctx, story); err != nil {
		return nil, err
	}

	return story.ToResponse(), nil
}

func (s *StoryService) Delete(storyID, userID uuid.UUID) error {
	ctx := context.Background()

	story, err := s.repo.FindByID(ctx, storyID)
	if err != nil {
		return err
	}
	if story == nil {
		return nil
	}
	if story.CreatorID != userID {
		return nil
	}

	return s.repo.Delete(ctx, storyID)
}

type StoryListResult struct {
	Stories []model.StoryResponse `json:"stories"`
	Total   int64                 `json:"total"`
}

func (s *StoryService) List(offset, limit int) (*StoryListResult, error) {
	ctx := context.Background()

	stories, total, err := s.repo.List(ctx, offset, limit)
	if err != nil {
		return nil, err
	}

	responses := make([]model.StoryResponse, 0, len(stories))
	for i := range stories {
		responses = append(responses, *stories[i].ToResponse())
	}

	return &StoryListResult{
		Stories: responses,
		Total:   total,
	}, nil
}
