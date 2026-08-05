package repository

import (
	"context"
	"errors"

	"backend/internal/model"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type StoryRepository struct {
	db *gorm.DB
}

func NewStoryRepository(db *gorm.DB) *StoryRepository {
	return &StoryRepository{db: db}
}

func (r *StoryRepository) FindByID(ctx context.Context, id uuid.UUID) (*model.Story, error) {
	var story model.Story
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&story).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &story, err
}

func (r *StoryRepository) Create(ctx context.Context, story *model.Story) error {
	return r.db.WithContext(ctx).Create(story).Error
}

func (r *StoryRepository) Update(ctx context.Context, story *model.Story) error {
	return r.db.WithContext(ctx).Save(story).Error
}

func (r *StoryRepository) Delete(ctx context.Context, id uuid.UUID) error {
	return r.db.WithContext(ctx).Delete(&model.Story{}, "id = ?", id).Error
}

func (r *StoryRepository) List(ctx context.Context, offset, limit int) ([]model.Story, int64, error) {
	return r.listWhere(ctx, r.db.WithContext(ctx).Model(&model.Story{}), offset, limit)
}

// ListPublished 只返回已发布作品（首页/社区浏览用）。
func (r *StoryRepository) ListPublished(ctx context.Context, offset, limit int) ([]model.Story, int64, error) {
	q := r.db.WithContext(ctx).Model(&model.Story{}).Where("status = ?", "published")
	return r.listWhere(ctx, q, offset, limit)
}

// ListByCreator 返回某创作者的全部作品（含草稿），供「我的作品」使用。
func (r *StoryRepository) ListByCreator(ctx context.Context, creatorID uuid.UUID, offset, limit int) ([]model.Story, int64, error) {
	q := r.db.WithContext(ctx).Model(&model.Story{}).Where("creator_id = ?", creatorID)
	return r.listWhere(ctx, q, offset, limit)
}

// listWhere 在给定查询上做「统计 + 分页 + 倒序」的公共逻辑。
func (r *StoryRepository) listWhere(ctx context.Context, q *gorm.DB, offset, limit int) ([]model.Story, int64, error) {
	var stories []model.Story
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := q.Order("created_at DESC").Offset(offset).Limit(limit).Find(&stories).Error
	return stories, total, err
}
