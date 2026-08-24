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

// 列表排序。**必须带稳定的次级键**：12 部作品的 play_count 现在全是 0，只按它排
// 在 Postgres 里次序不保证，首页每次刷新会重排——既难看，也直接违反设计稿 §6
// 「刷新一致」那条纪律（卡片位置一致但卡片本身在换，等于白做）。
//
// ⚠️ 查询已 LEFT JOIN users，所有列名必须带 stories. 前缀，否则报 ambiguous column。
const (
	OrderRecent = "stories.created_at DESC, stories.id"
	OrderPlays  = "stories.play_count DESC, stories.created_at DESC, stories.id"
)

func (r *StoryRepository) List(ctx context.Context, offset, limit int, order string) ([]model.Story, int64, error) {
	return r.listWhere(ctx, r.db.WithContext(ctx).Model(&model.Story{}), offset, limit, order)
}

// ListPublished 只返回已发布作品（首页/社区浏览用）。
func (r *StoryRepository) ListPublished(ctx context.Context, offset, limit int, order string) ([]model.Story, int64, error) {
	q := r.db.WithContext(ctx).Model(&model.Story{}).Where("stories.status = ?", "published")
	return r.listWhere(ctx, q, offset, limit, order)
}

// ListByCreator 返回某创作者的全部作品（含草稿），供「我的作品」使用。
func (r *StoryRepository) ListByCreator(ctx context.Context, creatorID uuid.UUID, offset, limit int) ([]model.Story, int64, error) {
	q := r.db.WithContext(ctx).Model(&model.Story{}).Where("stories.creator_id = ?", creatorID)
	// 作者看自己的东西按时间排才对，不按热度——这里不接受调用方指定排序。
	return r.listWhere(ctx, q, offset, limit, OrderRecent)
}

// listWhere 在给定查询上做「统计 + 分页 + 倒序」的公共逻辑。
// 先在未 join 的查询上 Count（join 只为带出作者昵称，不影响行数，也省一次多表扫描），
// 再挂 withCreator 取数据。注意：join 后 users 也有 status/created_at 列，
// 所有列名必须带 stories. 前缀，否则 Postgres 报 ambiguous column。
func (r *StoryRepository) listWhere(ctx context.Context, q *gorm.DB, offset, limit int, order string) ([]model.Story, int64, error) {
	if order == "" {
		order = OrderRecent
	}
	var stories []model.Story
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := withCreator(q).Order(order).Offset(offset).Limit(limit).Find(&stories).Error
	return stories, total, err
}

// IncrPlayCount 阅读量 +1。用 SQL 表达式而非先读后写——并发开局会丢更新。
func (r *StoryRepository) IncrPlayCount(ctx context.Context, storyID uuid.UUID) error {
	return r.db.WithContext(ctx).Model(&model.Story{}).Where("id = ?", storyID).
		UpdateColumn("play_count", gorm.Expr("play_count + 1")).Error
}
