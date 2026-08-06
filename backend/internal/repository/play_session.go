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

// CreateNodeAndUpdateSession 在一个事务内落一个新节点并让会话指向它：
// 先 Create(node)（回填其 ID），再把 session.CurrentNodeID 指向新节点后 Save(session)。
// 会话的其余字段（NodeCount / CurrentState / RevealedAttrs / Status / LastPlayedAt）
// 由调用方在调用前设置好；此处只负责“节点落库 + 指针指向”这对必须原子的操作。
// 跨表事务内聚于此仓储（node 与 session 同属游玩运行时生命周期），service 层不再触碰裸 *gorm.DB。
func (r *PlaySessionRepository) CreateNodeAndUpdateSession(ctx context.Context, node *model.StoryNode, s *model.PlaySession) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(node).Error; err != nil {
			return err
		}
		s.CurrentNodeID = &node.ID
		return tx.Save(s).Error
	})
}

// DeleteSessionCascade 事务删除一局会话及其全部节点（模型无外键，级联手动处理）。
func (r *PlaySessionRepository) DeleteSessionCascade(ctx context.Context, sessionID uuid.UUID) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("session_id = ?", sessionID).Delete(&model.StoryNode{}).Error; err != nil {
			return err
		}
		return tx.Delete(&model.PlaySession{}, "id = ?", sessionID).Error
	})
}
