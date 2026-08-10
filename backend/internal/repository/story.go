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

// withCreator 给查询挂上作者昵称的只读投影（model.Story.CreatorName）。
// 用 LEFT JOIN 而非 INNER：作者被删/数据不一致时作品仍可读出，署名留空即可。
func withCreator(q *gorm.DB) *gorm.DB {
	return q.Select("stories.*, users.nickname AS creator_name").
		Joins("LEFT JOIN users ON users.id = stories.creator_id")
}

func (r *StoryRepository) FindByID(ctx context.Context, id uuid.UUID) (*model.Story, error) {
	var story model.Story
	err := withCreator(r.db.WithContext(ctx).Model(&model.Story{})).
		Where("stories.id = ?", id).First(&story).Error
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
	q := r.db.WithContext(ctx).Model(&model.Story{}).Where("stories.status = ?", "published")
	return r.listWhere(ctx, q, offset, limit)
}

// ListByCreator 返回某创作者的全部作品（含草稿），供「我的作品」使用。
func (r *StoryRepository) ListByCreator(ctx context.Context, creatorID uuid.UUID, offset, limit int) ([]model.Story, int64, error) {
	q := r.db.WithContext(ctx).Model(&model.Story{}).Where("stories.creator_id = ?", creatorID)
	return r.listWhere(ctx, q, offset, limit)
}

// listWhere 在给定查询上做「统计 + 分页 + 倒序」的公共逻辑。
// 先在未 join 的查询上 Count（join 只为带出作者昵称，不影响行数，也省一次多表扫描），
// 再挂 withCreator 取数据。注意：join 后 users 也有 status/created_at 列，
// 所有列名必须带 stories. 前缀，否则 Postgres 报 ambiguous column。
func (r *StoryRepository) listWhere(ctx context.Context, q *gorm.DB, offset, limit int) ([]model.Story, int64, error) {
	var stories []model.Story
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := withCreator(q).Order("stories.created_at DESC").Offset(offset).Limit(limit).Find(&stories).Error
	return stories, total, err
}
