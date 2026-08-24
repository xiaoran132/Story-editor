package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// StoryLike 一个人对一部作品的赞。
//
// ⚠️ 幂等的真源是 (story_id, user_id) 上的唯一索引，不是 service 里的「先查再插」——
// 并发下先查再插会双插，而 like_count 是靠 RowsAffected 判断要不要 +1 的，
// 双插就等于计数被加两次。所以插入走 ON CONFLICT DO NOTHING，让数据库裁决。
//
// 归属：这张表和 stories.like_count 一起放在 story 模块，不在 community。
// 理由是计数列本来就在 stories 上，插入与计数更新必须同事务；为一个功能先造一个
// community 模块，再为它开一个只用来改计数的 port，是把接缝造在没有断层的地方。
// 等 community 真落地（动态流 / 关注 / 分叉）再迁，那时是重命名加一个 port。
type StoryLike struct {
	ID uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	// 复合唯一索引：同一个人对同一部作品只可能有一行
	StoryID   uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:uniq_story_user_like,priority:1" json:"story_id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:uniq_story_user_like,priority:2;index:idx_story_likes_user" json:"user_id"`
	CreatedAt time.Time `json:"created_at"`
}

func (l *StoryLike) BeforeCreate(tx *gorm.DB) error {
	if l.ID == uuid.Nil {
		l.ID = uuid.New()
	}
	return nil
}

// LikeResult 是点赞/取消赞的返回体：调用方要的就是这两个数，
// 让它自己再拉一次作品详情只为看新计数是多余的往返。
type LikeResult struct {
	Liked     bool `json:"liked"`
	LikeCount int  `json:"like_count"`
}
