package repository

import (
	"context"
	"errors"

	"backend/internal/model"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type PlaySessionRepository struct {
	db *gorm.DB
}

func NewPlaySessionRepository(db *gorm.DB) *PlaySessionRepository {
	return &PlaySessionRepository{db: db}
}

func (r *PlaySessionRepository) Create(ctx context.Context, s *model.PlaySession) error {
	return r.db.WithContext(ctx).Create(s).Error
}

func (r *PlaySessionRepository) FindByID(ctx context.Context, id uuid.UUID) (*model.PlaySession, error) {
	var s model.PlaySession
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&s).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &s, err
}

// FindByPlayerID 列出某玩家的全部会话，按最近游玩时间倒序（供读档/续玩列表）。
func (r *PlaySessionRepository) FindByPlayerID(ctx context.Context, playerID uuid.UUID) ([]model.PlaySession, error) {
	var sessions []model.PlaySession
	err := r.db.WithContext(ctx).
		Where("player_id = ?", playerID).
		Order("last_played_at DESC").
		Find(&sessions).Error
	return sessions, err
}

func (r *PlaySessionRepository) Update(ctx context.Context, s *model.PlaySession) error {
	return r.db.WithContext(ctx).Save(s).Error
}

// MigrateGuestSessions 把 guest 名下、且 id 在 ids 内的会话改归 userID（登录后领取匿名进度）。
// 只动 guest 的会话（避免误领他人），返回实际迁移条数。
func (r *PlaySessionRepository) MigrateGuestSessions(ctx context.Context, userID, guestID uuid.UUID, ids []uuid.UUID) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	res := r.db.WithContext(ctx).Model(&model.PlaySession{}).
		Where("player_id = ? AND id IN ?", guestID, ids).
		Update("player_id", userID)
	return res.RowsAffected, res.Error
}

// DB 暴露底层连接，供 service 层做跨仓储事务（写节点 + 更新会话）。
func (r *PlaySessionRepository) DB() *gorm.DB {
	return r.db
}
