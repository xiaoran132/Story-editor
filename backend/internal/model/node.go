package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type StoryNode struct {
	ID               uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	SessionID        uuid.UUID  `gorm:"type:uuid;not null;index" json:"session_id"`
	StoryID          uuid.UUID  `gorm:"type:uuid;not null;index" json:"story_id"`
	ParentID         *uuid.UUID `gorm:"type:uuid;index" json:"parent_id"`
	Depth            int        `gorm:"not null;default:0" json:"depth"`
	ChoiceText       *string    `gorm:"type:text" json:"choice_text"`
	Content          string     `gorm:"type:text;not null" json:"content"`
	Summary          string     `gorm:"type:text;not null;default:''" json:"summary"` // ④节点树增量摘要：截至该节点的滚动前情提要，续写时喂回
	SuggestedOptions string     `gorm:"type:jsonb;not null;default:'[]'" json:"suggested_options"`
	StateDelta       string     `gorm:"type:jsonb;not null;default:'{}'" json:"state_delta"`
	StateSnapshot    string     `gorm:"type:jsonb;not null;default:'{}'" json:"state_snapshot"`
	IsEnding         bool       `gorm:"not null;default:false" json:"is_ending"`
	EndingType       *string    `gorm:"size:20" json:"ending_type"`
	IsPublic         bool       `gorm:"not null;default:false" json:"is_public"`
	VisitCount       int        `gorm:"not null;default:0" json:"visit_count"`
	CreatedAt        time.Time  `json:"created_at"`
}

func (n *StoryNode) BeforeCreate(tx *gorm.DB) error {
	if n.ID == uuid.Nil {
		n.ID = uuid.New()
	}
	return nil
}

type NodeResponse struct {
	ID               uuid.UUID  `json:"id"`
	SessionID        uuid.UUID  `json:"session_id"`
	StoryID          uuid.UUID  `json:"story_id"`
	ParentID         *uuid.UUID `json:"parent_id"`
	Depth            int        `json:"depth"`
	ChoiceText       *string    `json:"choice_text"`
	Content          string     `json:"content"`
	Summary          string     `json:"summary"`
	SuggestedOptions string     `json:"suggested_options"`
	StateDelta       string     `json:"state_delta"`
	StateSnapshot    string     `json:"state_snapshot"`
	IsEnding         bool       `json:"is_ending"`
	EndingType       *string    `json:"ending_type"`
	IsPublic         bool       `json:"is_public"`
	VisitCount       int        `json:"visit_count"`
	CreatedAt        time.Time  `json:"created_at"`
}

func (n *StoryNode) ToResponse() *NodeResponse {
	return &NodeResponse{
		ID:               n.ID,
		SessionID:        n.SessionID,
		StoryID:          n.StoryID,
		ParentID:         n.ParentID,
		Depth:            n.Depth,
		ChoiceText:       n.ChoiceText,
		Content:          n.Content,
		Summary:          n.Summary,
		SuggestedOptions: n.SuggestedOptions,
		StateDelta:       n.StateDelta,
		StateSnapshot:    n.StateSnapshot,
		IsEnding:         n.IsEnding,
		EndingType:       n.EndingType,
		IsPublic:         n.IsPublic,
		VisitCount:       n.VisitCount,
		CreatedAt:        n.CreatedAt,
	}
}
