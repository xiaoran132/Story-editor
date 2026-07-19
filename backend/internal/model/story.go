package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Story struct {
	ID             uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	CreatorID      uuid.UUID  `gorm:"type:uuid;not null;index:idx_stories_creator" json:"creator_id"`
	Title          string     `gorm:"size:200;not null" json:"title"`
	Description    string     `gorm:"type:text" json:"description"`
	CoverURL       string     `gorm:"type:text" json:"cover_url"`
	WorldConfig    string     `gorm:"type:jsonb;not null;default:'{}'" json:"world_config"`
	OpeningContent string     `gorm:"type:text" json:"opening_content"`
	Status         string     `gorm:"size:20;not null;default:draft" json:"status"`
	PriceConfig    string     `gorm:"type:jsonb;not null;default:'{\"type\":\"free\"}'" json:"price_config"`
	PlayCount      int        `gorm:"not null;default:0" json:"play_count"`
	LikeCount      int        `gorm:"not null;default:0" json:"like_count"`
	FavoriteCount  int        `gorm:"not null;default:0" json:"favorite_count"`
	CommentCount   int        `gorm:"not null;default:0" json:"comment_count"`
	ShareCount     int        `gorm:"not null;default:0" json:"share_count"`
	PublishedAt    *time.Time `json:"published_at"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

func (s *Story) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	return nil
}

type StoryResponse struct {
	ID             uuid.UUID  `json:"id"`
	CreatorID      uuid.UUID  `json:"creator_id"`
	Title          string     `json:"title"`
	Description    string     `json:"description"`
	CoverURL       string     `json:"cover_url"`
	WorldConfig    string     `json:"world_config"`
	OpeningContent string     `json:"opening_content"`
	Status         string     `json:"status"`
	PriceConfig    string     `json:"price_config"`
	PlayCount      int        `json:"play_count"`
	LikeCount      int        `json:"like_count"`
	FavoriteCount  int        `json:"favorite_count"`
	CommentCount   int        `json:"comment_count"`
	ShareCount     int        `json:"share_count"`
	PublishedAt    *time.Time `json:"published_at"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

func (s *Story) ToResponse() *StoryResponse {
	return &StoryResponse{
		ID:             s.ID,
		CreatorID:      s.CreatorID,
		Title:          s.Title,
		Description:    s.Description,
		CoverURL:       s.CoverURL,
		WorldConfig:    s.WorldConfig,
		OpeningContent: s.OpeningContent,
		Status:         s.Status,
		PriceConfig:    s.PriceConfig,
		PlayCount:      s.PlayCount,
		LikeCount:      s.LikeCount,
		FavoriteCount:  s.FavoriteCount,
		CommentCount:   s.CommentCount,
		ShareCount:     s.ShareCount,
		PublishedAt:    s.PublishedAt,
		CreatedAt:      s.CreatedAt,
		UpdatedAt:      s.UpdatedAt,
	}
}
