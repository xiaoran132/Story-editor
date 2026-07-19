package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// PlaySession 一条记录 = 某个玩家开始玩某部作品的一局游戏。
// current_state 存完整状态快照（唯一事实来源），随节点推进更新。
type PlaySession struct {
	ID              uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	StoryID         uuid.UUID  `gorm:"type:uuid;not null;index" json:"story_id"`
	PlayerID        uuid.UUID  `gorm:"type:uuid;not null;index" json:"player_id"`
	CurrentState    string     `gorm:"type:jsonb;not null;default:'{}'" json:"current_state"`
	ProtagonistName *string    `gorm:"size:30" json:"protagonist_name"`
	CurrentNodeID   *uuid.UUID `gorm:"type:uuid" json:"current_node_id"`
	Status          string     `gorm:"size:20;not null;default:active" json:"status"`
	NodeCount       int        `gorm:"not null;default:0" json:"node_count"`
	PlayDuration    int        `gorm:"not null;default:0" json:"play_duration"`
	LastPlayedAt    time.Time  `json:"last_played_at"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

func (s *PlaySession) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	return nil
}

type SessionResponse struct {
	ID              uuid.UUID  `json:"id"`
	StoryID         uuid.UUID  `json:"story_id"`
	PlayerID        uuid.UUID  `json:"player_id"`
	CurrentState    string     `json:"current_state"`
	ProtagonistName *string    `json:"protagonist_name"`
	CurrentNodeID   *uuid.UUID `json:"current_node_id"`
	Status          string     `json:"status"`
	NodeCount       int        `json:"node_count"`
	LastPlayedAt    time.Time  `json:"last_played_at"`
	CreatedAt       time.Time  `json:"created_at"`
}

func (s *PlaySession) ToResponse() *SessionResponse {
	return &SessionResponse{
		ID:              s.ID,
		StoryID:         s.StoryID,
		PlayerID:        s.PlayerID,
		CurrentState:    s.CurrentState,
		ProtagonistName: s.ProtagonistName,
		CurrentNodeID:   s.CurrentNodeID,
		Status:          s.Status,
		NodeCount:       s.NodeCount,
		LastPlayedAt:    s.LastPlayedAt,
		CreatedAt:       s.CreatedAt,
	}
}
