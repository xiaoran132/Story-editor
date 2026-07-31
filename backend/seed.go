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

	// 3. 丰富测试作品（含 outline/characters/attributes；opening_content 留空由 AI 生成开局）。
	//    按标题幂等，逐个补齐——不受上面 demo 的 count 门控影响。
	for _, s := range richSeedStories(guest.ID) {
		if err := ensureStory(db, s); err != nil {
			return uuid.Nil, err
		}
	}

	return guest.ID, nil
}

// ensureStory 按 (creator_id, title) upsert 测试作品：不存在则建；已存在则更新可变配置
// （world_config/description/opening/status），保持同一 ID 以免影响已有会话。
// 这样这些种子作品以 seed.go 为准，改了配置重启即生效，又不会级联删掉在玩的会话。
func ensureStory(db *gorm.DB, s model.Story) error {
	var existing model.Story
	err := db.Where("creator_id = ? AND title = ?", s.CreatorID, s.Title).First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return db.Create(&s).Error
	}
	if err != nil {
		return err
	}
	return db.Model(&existing).Updates(map[string]any{
		"world_config":    s.WorldConfig,
		"description":     s.Description,
		"opening_content": s.OpeningContent,
		"status":          s.Status,
	}).Error
}

// richSeedStories 返回三部题材各异、配置丰富的测试作品（悬疑/奇幻/末世）。
// 用途：作为打磨 AI 叙事质量与玩法深度的测试床；opening_content 留空以测真·AI 开局流式。
func richSeedStories(creatorID uuid.UUID) []model.Story {
	return []model.Story{
		{
			CreatorID:   creatorID,
			Title:       "孤岛探案·上海一九三七",
			Description: "民国孤岛时期的上海法租界，你是私家侦探，受富商遗孀之托查一桩离奇命案。线索、证词与人心，谁在说谎？",
			Status:      "published",
			PriceConfig: `{"type":"free"}`,
			WorldConfig: `{
  "background": "1937年孤岛时期的上海法租界。灯红酒绿之下暗流涌动，你是小有名气的私家侦探，受富商遗孀苏眉之托，调查其丈夫在书房中的离奇死亡——警方草草定为自杀，但她不信。",
  "style": "冷峻、悬疑、时代质感，重线索推理与人物博弈",
  "rules": "线索需主动搜集与串联；贸然指认会打草惊蛇（提升怀疑度）；不同人物对你的信任度影响他们愿意透露多少；关键证物可用于对质。",
  "outline": "核心悬念:富商之死是自杀、他杀还是另有隐情。三幕:接案勘查现场→走访嫌疑人、比对矛盾证词→揭破真凶或落入陷阱。关键锚点:书房暗格里的账本、姨太太与账房先生的私情、码头的走私线索、遗孀本人的算计。可能结局:缉凶归案(good)/被灭口沉尸黄浦江(bad)/查明真相却被迫收声(hidden)。",
  "characters": [
    {"name": "苏眉", "role": "委托人", "personality": "优雅克制，悲伤之下似藏着算计"},
    {"name": "陈账房", "role": "嫌疑人", "personality": "谨小慎微，眼神闪烁，似有隐情"},
    {"name": "探长老马", "role": "亦敌亦友", "personality": "老练世故，与你有旧，办案讲人情也讲规矩"}
  ],
  "initial_state": {"线索": 0, "怀疑度": 0, "信任": 50, "location": "命案现场·书房", "证物": []},
  "attributes": {
    "线索": {"type": "number", "initial": 0},
    "怀疑度": {"type": "number", "initial": 0, "hidden": true},
    "信任": {"type": "number", "initial": 50},
    "location": {"type": "scalar", "initial": "命案现场·书房"},
    "证物": {"type": "set", "initial": []}
  }
}`,
		},
		{
			CreatorID:   creatorID,
			Title:       "云顶学院·灰纹裂隙",
			Description: "悬浮云海之上的魔法学院，你是被排挤的平民学徒，却在禁书区发现一道通往学院禁地的裂隙。真相，还是自保？",
			Status:      "published",
			PriceConfig: `{"type":"free"}`,
			WorldConfig: `{
  "background": "悬浮于云海之上的云顶魔法学院。你是平民出身的新生，被分入最不受待见的『灰纹』学院，处处遭世家子弟排挤。开学第一周，你在禁书区偶然发现一道幽蓝的裂隙，似乎通向学院尘封的禁地。",
  "style": "奇幻、少年成长，明快中带悬疑与阴谋",
  "rules": "施法消耗魔力，魔力耗尽会虚脱；违规探索提升处分风险，过高会被退学；与导师、同窗的关系影响你能借到的资源与情报；习得的法术可在合适情境施展。",
  "outline": "核心:平民学徒一步步揭开学院禁地隐藏的百年秘密，并在此过程中立足与成长。三幕:入学立足、遭排挤中寻找盟友→在禁书区与裂隙中收集线索、习得禁术→抉择揭露真相、自保还是攫取力量。关键锚点:灰纹学院被排挤的真正缘由、凛老师讳莫如深的过去、裂隙尽头的封印与代价。可能结局:成为撼动旧秩序的革新者(good)/被抹去记忆逐出学院(bad)/独占秘密登上高位(hidden)。",
  "characters": [
    {"name": "凛老师", "role": "导师", "personality": "严厉冷淡、不近人情，却屡屡在暗中庇护你"},
    {"name": "卡尔·维恩", "role": "对手", "personality": "傲慢的世家子弟，视你为眼中钉，实则外强中干"},
    {"name": "无名学长", "role": "引路人", "personality": "亦正亦邪，总在关键时刻出现，动机不明"}
  ],
  "initial_state": {"魔力": 30, "学分": 0, "处分风险": 0, "location": "灰纹学院·新生宿舍", "法术": ["微光术"]},
  "attributes": {
    "魔力": {"type": "number", "initial": 30},
    "学分": {"type": "number", "initial": 0},
    "处分风险": {"type": "number", "initial": 0, "hidden": true},
    "location": {"type": "scalar", "initial": "灰纹学院·新生宿舍"},
    "法术": {"type": "set", "initial": ["微光术"]}
  }
}`,
		},
		{
			CreatorID:   creatorID,
			Title:       "最后的深夜电台",
			Description: "丧尸爆发第七天，你是城中最后一座电台的深夜DJ，用微弱电波维系幸存者的希望——也吸引着未知的注意。",
			Status:      "published",
			PriceConfig: `{"type":"free"}`,
			WorldConfig: `{
  "background": "丧尸爆发后的第七天。城市已成废墟，你是最后一座还在运作的电台的深夜DJ，用微弱的电波向黑暗中的幸存者播报安全路线与希望。但你不知道电台为何还有电，也不知道电波正把什么吸引过来。",
  "style": "末世、孤独、紧张，重人性抉择与资源取舍",
  "rules": "每个决定消耗或获得物资、影响幸存者对你的信任；对外广播会同时招来幸存者与危险；长期孤独与恐惧会侵蚀理智，理智过低会误判甚至幻听；装备可在外出时使用。",
  "outline": "核心:在『维持希望的广播』与『自我求生』之间抉择，并查明电台为何还有电、谁在暗中注视。三幕:维持广播、引来幸存者与威胁→物资告急，必须冒险外出补给→揭开城市停电真相，做出撤离或坚守的最终抉择。关键锚点:地下室仍在运转的柴油发电机、一个持续用对讲机呼救的女孩、老台长留下的最后一盘磁带日志。可能结局:带幸存者成功撤离(good)/电台被攻陷、广播沦为绝唱(bad)/独自守台、成为电波里的传说(hidden)。",
  "characters": [
    {"name": "小满", "role": "求救者", "personality": "惊恐却坚韧的女孩，只能通过对讲机联系你，是你坚持下去的理由"},
    {"name": "老陈", "role": "同伴", "personality": "沉默寡言的退伍老兵，提供保护，但似乎藏着关于爆发起因的秘密"},
    {"name": "电波里的声音", "role": "神秘", "personality": "身份不明，偶尔切入你的频率，似乎知道得太多"}
  ],
  "initial_state": {"hp": 100, "物资": 5, "信任": 40, "理智": 75, "location": "电台·播音室", "装备": ["对讲机"]},
  "attributes": {
    "hp": {"type": "number", "initial": 100},
    "物资": {"type": "number", "initial": 5},
    "信任": {"type": "number", "initial": 40},
    "理智": {"type": "number", "initial": 75},
    "location": {"type": "scalar", "initial": "电台·播音室"},
    "装备": {"type": "set", "initial": ["对讲机"]}
  }
}`,
		},
	}
}
