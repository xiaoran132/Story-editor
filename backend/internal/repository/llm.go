package repository

import (
	"context"
	"errors"

	"backend/internal/model"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// LLMRepository 管理用户 LLM 连接（llm_connections）与平台设置（platform_llm_settings）。
type LLMRepository struct {
	db *gorm.DB
}

func NewLLMRepository(db *gorm.DB) *LLMRepository {
	return &LLMRepository{db: db}
}

// ----- 用户连接 -----

func (r *LLMRepository) CreateConnection(ctx context.Context, conn *model.LLMConnection) error {
	return r.db.WithContext(ctx).Create(conn).Error
}

func (r *LLMRepository) UpdateConnection(ctx context.Context, conn *model.LLMConnection) error {
	return r.db.WithContext(ctx).Save(conn).Error
}

// FindConnByID 按 id 取连接（不校验归属，归属由 service 比对 UserID）。不存在返回 (nil, nil)。
func (r *LLMRepository) FindConnByID(ctx context.Context, id uuid.UUID) (*model.LLMConnection, error) {
	var conn model.LLMConnection
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&conn).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &conn, err
}

// ListConnsByUser 列出某用户全部连接，按创建时间正序。
func (r *LLMRepository) ListConnsByUser(ctx context.Context, userID uuid.UUID) ([]model.LLMConnection, error) {
	var conns []model.LLMConnection
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).Order("created_at asc").Find(&conns).Error
	return conns, err
}

// DeleteConnection 删除某用户名下的一条连接（归属条件内联，防越权删他人）。
func (r *LLMRepository) DeleteConnection(ctx context.Context, userID, id uuid.UUID) error {
	return r.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", id, userID).
		Delete(&model.LLMConnection{}).Error
}

// ----- 作品级配置（user_story_llm_configs） -----

// FindStoryConfig 取某玩家在某作品的配置。不存在返回 (nil, nil)。
func (r *LLMRepository) FindStoryConfig(ctx context.Context, userID, storyID uuid.UUID) (*model.UserStoryLLMConfig, error) {
	var c model.UserStoryLLMConfig
	err := r.db.WithContext(ctx).Where("user_id = ? AND story_id = ?", userID, storyID).First(&c).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &c, err
}

// UpsertStoryConfig 按 (user_id, story_id) 复合主键 upsert。
func (r *LLMRepository) UpsertStoryConfig(ctx context.Context, c *model.UserStoryLLMConfig) error {
	return r.db.WithContext(ctx).Save(c).Error
}

// ----- 平台设置 -----

// ListPlatform 返回全部平台环节设置。
func (r *LLMRepository) ListPlatform(ctx context.Context) ([]model.PlatformLLMSetting, error) {
	var rows []model.PlatformLLMSetting
	err := r.db.WithContext(ctx).Find(&rows).Error
	return rows, err
}

// FindPlatform 取某环节平台设置。不存在返回 (nil, nil)。
func (r *LLMRepository) FindPlatform(ctx context.Context, stage string) (*model.PlatformLLMSetting, error) {
	var s model.PlatformLLMSetting
	err := r.db.WithContext(ctx).Where("stage = ?", stage).First(&s).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &s, err
}

// UpsertPlatform 按 stage 主键 upsert（存在则整行覆盖）。
func (r *LLMRepository) UpsertPlatform(ctx context.Context, s *model.PlatformLLMSetting) error {
	return r.db.WithContext(ctx).Save(s).Error
}

// ----- 平台额度（注册赠 1 元）与用量流水 -----

// GetCredit 读某用户的平台额度余额（微元）。用户不存在返回 (0, nil)——
// 匿名/已删号一律视为无额度，不用错误表达"没有余额"这件正常的事。
func (r *LLMRepository) GetCredit(ctx context.Context, userID uuid.UUID) (int64, error) {
	var credit int64
	err := r.db.WithContext(ctx).Model(&model.User{}).
		Where("id = ?", userID).Select("credit_micro_cny").Scan(&credit).Error
	return credit, err
}

// ChargeCredit 扣减额度并记一行流水，两件事在同一事务里。
//
// 扣减用 GREATEST(0, ...) 在 **SQL 里**做，而不是先读后写：并发的两个回合各自读到
// 同一个余额再各写回，会把一次消费吞掉。余额不足时扣到 0 为止——扣费发生在回合结束
// 之后（此时 token 已经烧掉了），事前无法预知花多少，所以最后一回合允许略微透支。
func (r *LLMRepository) ChargeCredit(ctx context.Context, log *model.LLMUsageLog) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.User{}).Where("id = ?", log.UserID).
			Update("credit_micro_cny", gorm.Expr("GREATEST(0, credit_micro_cny - ?)", log.CostMicroCNY)).
			Error; err != nil {
			return err
		}
		return tx.Create(log).Error
	})
}
