package repository

import (
	"context"

	"backend/internal/model"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type StoryLikeRepository struct {
	db *gorm.DB
}

func NewStoryLikeRepository(db *gorm.DB) *StoryLikeRepository {
	return &StoryLikeRepository{db: db}
}

// Like 点赞，幂等：已经赞过再点一次不报错，也不会把计数加第二遍。
//
// 插入与计数更新在**同一个事务**里：两条语句分开跑的话，中间崩一次就会留下
// 「有赞记录但计数没加」或反过来的脏数据，而这类漂移没有任何自愈路径。
//
// ⚠️ 计数走 like_count + 1 的表达式，不是先读到内存再写回——后者在并发下会丢更新
// （两个请求都读到 3，都写回 4）。
func (r *StoryLikeRepository) Like(ctx context.Context, storyID, userID uuid.UUID) (int, error) {
	var count int
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Clauses(clause.OnConflict{DoNothing: true}).
			Create(&model.StoryLike{StoryID: storyID, UserID: userID})
		if res.Error != nil {
			return res.Error
		}
		// RowsAffected == 0 说明唯一索引挡下了重复点赞，计数不能再动
		if res.RowsAffected > 0 {
			if err := tx.Model(&model.Story{}).Where("id = ?", storyID).
				UpdateColumn("like_count", gorm.Expr("like_count + 1")).Error; err != nil {
				return err
			}
		}
		return tx.Model(&model.Story{}).Where("id = ?", storyID).
			Pluck("like_count", &count).Error
	})
	return count, err
}

// Unlike 取消赞，同样幂等：没赞过也返回成功和当前计数。
func (r *StoryLikeRepository) Unlike(ctx context.Context, storyID, userID uuid.UUID) (int, error) {
	var count int
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Where("story_id = ? AND user_id = ?", storyID, userID).
			Delete(&model.StoryLike{})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected > 0 {
			// GREATEST 兜底：计数若曾被手工改乱过，减法不该把它带到负数——
			// 一个负的赞数比一个偏小的赞数更难解释。
			if err := tx.Model(&model.Story{}).Where("id = ?", storyID).
				UpdateColumn("like_count", gorm.Expr("GREATEST(like_count - 1, 0)")).Error; err != nil {
				return err
			}
		}
		return tx.Model(&model.Story{}).Where("id = ?", storyID).
			Pluck("like_count", &count).Error
	})
	return count, err
}

// Liked 查「这个人赞过这部作品没有」。未登录不该走到这里（调用方先判 uuid.Nil）。
func (r *StoryLikeRepository) Liked(ctx context.Context, storyID, userID uuid.UUID) (bool, error) {
	var n int64
	err := r.db.WithContext(ctx).Model(&model.StoryLike{}).
		Where("story_id = ? AND user_id = ?", storyID, userID).
		Count(&n).Error
	return n > 0, err
}
