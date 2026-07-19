package main

import (
	"errors"

	"backend/internal/model"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// seed 幂等地预置一个 guest 用户和一部 demo 作品，
// 让 MVP 阶段无需创作模块即可直接开玩。返回 guest 用户 ID。
func seed(db *gorm.DB) (uuid.UUID, error) {
	// 1. guest 用户
	var guest model.User
	err := db.Where("username = ?", "guest").First(&guest).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		guest = model.User{
			Username: "guest",
			Nickname: "游客",
			Role:     "user",
			Status:   "active",
		}
		if err := db.Create(&guest).Error; err != nil {
			return uuid.Nil, err
		}
	} else if err != nil {
		return uuid.Nil, err
	}

	// 2. demo 作品（若 guest 名下还没有作品则创建）
	var count int64
	if err := db.Model(&model.Story{}).Where("creator_id = ?", guest.ID).Count(&count).Error; err != nil {
		return uuid.Nil, err
	}
	if count == 0 {
		demo := model.Story{
			CreatorID:      guest.ID,
			Title:          "迷雾古堡",
			Description:    "一部悬疑向的互动短篇：你在暴雨夜误入一座废弃古堡，必须在天亮前找到出路。",
			Status:         "published",
			OpeningContent: "暴雨如注。你的车在山路上抛锚，唯一的灯光来自远处山坡上一座阴森的古堡。你浑身湿透，别无选择，只能推开那扇吱呀作响的橡木大门。门厅里烛火摇曳，空气中弥漫着尘土与铁锈的气味。楼梯尽头似乎有脚步声，而你的手机只剩最后 5% 的电量。",
			WorldConfig: `{
  "background": "一座与世隔绝的废弃古堡，传说上一任主人离奇失踪，堡内机关重重。",
  "style": "mystery",
  "rules": "夜晚会有异响，理智值过低会产生幻觉；某些门需要钥匙或密码。",
  "initial_state": {"hp": 100, "sanity": 80, "clues": 0}
}`,
			PriceConfig: `{"type":"free"}`,
		}
		if err := db.Create(&demo).Error; err != nil {
			return uuid.Nil, err
		}
	}

	return guest.ID, nil
}
