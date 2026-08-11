package main

import (
	"errors"
	"log"

	"backend/internal/model"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// seed 幂等地预置一个 guest 用户和一批 demo 作品，让首页开箱就有内容可看。
// guest 仅作为演示作品的**作者**存在；游玩需登录，它不再承载匿名会话。
// 返回 guest 用户 ID。
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

	// 1.5 自愈：guest 被删过再重建时 ID 会变，而 ensureStory 按 (creator_id, title) 幂等，
	//     认不出旧 guest 名下的同名作品 → 每次重启都再建一整套，首页就出现「每部作品两份」。
	//     这里先把无主/旧 guest 的同名种子作品认领回当前 guest，并只保留最早那份
	//     （它带着玩家的会话历史），删掉后来重复建的。
	if err := healSeedDuplicates(db, guest.ID); err != nil {
		return uuid.Nil, err
	}

	// 2. 清理已下线的种子作品（迷雾古堡改版后移除）。
	//    Story 无软删除，硬删会经 FK ON DELETE CASCADE 一并清掉其会话/节点——仅 demo 数据，无碍。
	if err := db.Where("creator_id = ? AND title = ?", guest.ID, "迷雾古堡").
		Delete(&model.Story{}).Error; err != nil {
		return uuid.Nil, err
	}

	// 3. 丰富测试作品（含 outline/characters/attributes；opening_content 留空由 AI 生成开局）。
	//    按标题幂等，逐个补齐。
	for _, s := range richSeedStories(guest.ID) {
		if err := ensureStory(db, s); err != nil {
			return uuid.Nil, err
		}
	}

	return guest.ID, nil
}

// healSeedDuplicates 修复「guest 被删号后重建」留下的重复种子作品。
//
// 只处理**种子标题**、且**无主或属于当前 guest**的行——真实用户名下的同名作品绝不碰。
// 同一标题存在多行时保留 created_at 最早的一份（它挂着已有的游玩会话，删掉会级联清空玩家进度），
// 其余删除；保留的那份若还挂在旧 creator_id 上，认领给当前 guest，
// 这样后续 ensureStory 的 (creator_id, title) 判定重新对得上，不会再产生新副本。
func healSeedDuplicates(db *gorm.DB, guestID uuid.UUID) error {
	for _, s := range richSeedStories(guestID) {
		var rows []model.Story
		err := db.Where("title = ?", s.Title).
			Where("creator_id = ? OR creator_id NOT IN (SELECT id FROM users)", guestID).
			Order("created_at ASC").
			Find(&rows).Error
		if err != nil {
			return err
		}
		if len(rows) == 0 {
			continue
		}
		for _, dup := range rows[1:] {
			if err := db.Delete(&model.Story{}, "id = ?", dup.ID).Error; err != nil {
				return err
			}
			log.Printf("seed: 清理重复种子作品 %q（id=%s，creator=%s）", s.Title, dup.ID, dup.CreatorID)
		}
		if keep := rows[0]; keep.CreatorID != guestID {
			if err := db.Model(&model.Story{}).Where("id = ?", keep.ID).
				Update("creator_id", guestID).Error; err != nil {
				return err
			}
			log.Printf("seed: 认领无主种子作品 %q（id=%s）到当前 guest", s.Title, keep.ID)
		}
	}
	return nil
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

// richSeedStories 返回六部题材各异、配置丰富的测试作品：
// 民国推理 / 奇幻学院 / 末世生存 / 武侠江湖 / 赛博朋克 / 治愈日常。
// 用途：作为打磨 AI 叙事质量与玩法深度的测试床；opening_content 留空以测真·AI 开局流式。
//
// 属性设计约定（逐部已核对，保证逻辑一致）：
//   - initial_state 的键与 attributes 的键严格一一对应；值与声明类型匹配
//     （number→数值 / scalar→字符串 / set→数组）。
//   - hidden=true：仅供 AI 参考的幕后压力量（怀疑度/处分风险/杀气/警戒/思念），玩家端永不显示。
//   - reveal=true：开局尚未被剧情建立的属性（需清点的资源、尚未结识者的关系、未知的记忆），
//     玩家发现前不显示，由 AI 在剧情建立时经 revealed 揭示——避免开局硬显示"指向不明"的属性。
//   - 开局可见的属性都应是"此刻即成立"的（hp/位置/随身之物/自身状态）。
func richSeedStories(creatorID uuid.UUID) []model.Story {
	return []model.Story{
		{
			CreatorID:   creatorID,
			Title:       "孤岛探案·上海一九三七",
			Description: "民国孤岛时期的上海法租界，你是私家侦探，受富商遗孀之托查一桩离奇命案。线索、证词与人心，谁在说谎？",
			Status:      "published",
			PriceConfig: `{"type":"free"}`,
			WorldConfig: `{
  "theme": "horror",
  "tags": ["悬疑推理", "民国", "本格"],
  "background": "1937年孤岛时期的上海法租界。灯红酒绿之下暗流涌动，你是小有名气的私家侦探，受富商遗孀苏眉之托，调查其丈夫在书房中的离奇死亡——警方草草定为自杀，但她不信。",
  "style": "冷峻、悬疑、时代质感，重线索推理与人物博弈",
  "rules": "线索需主动搜集与串联；贸然指认会打草惊蛇（提升怀疑度）；不同人物对你的信任度影响他们愿意透露多少，信任在与人真正打交道后才逐渐明朗；关键证物可用于对质。",
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
    "信任": {"type": "number", "initial": 50, "reveal": true},
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
  "theme": "xian",
  "tags": ["奇幻", "校园", "成长"],
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
  "theme": "radio",
  "tags": ["末世生存", "孤独", "抉择"],
  "background": "丧尸爆发后的第七天。城市已成废墟，你是最后一座还在运作的电台的深夜DJ，用微弱的电波向黑暗中的幸存者播报安全路线与希望。但你不知道电台为何还有电，也不知道电波正把什么吸引过来。",
  "style": "末世、孤独、紧张，重人性抉择与资源取舍",
  "rules": "每个决定消耗或获得物资、影响幸存者对你的信任；对外广播会同时招来幸存者与危险；长期孤独与恐惧会侵蚀理智，理智过低会误判甚至幻听；装备可在外出时使用。",
  "outline": "核心:在『维持希望的广播』与『自我求生』之间抉择，并查明电台为何还有电、谁在暗中注视。三幕:维持广播、引来幸存者与威胁→物资告急，必须冒险外出补给→揭开城市停电真相，做出撤离或坚守的最终抉择。关键锚点:地下室仍在运转的柴油发电机、一个持续用对讲机呼救的女孩、老台长留下的最后一盘磁带日志。可能结局:带幸存者成功撤离(good)/电台被攻陷、广播沦为绝唱(bad)/独自守台、成为电波里的传说(hidden)。",
  "characters": [
    {"name": "小满", "role": "求救者", "personality": "惊恐却坚韧的女孩，只能通过对讲机联系你，是你坚持下去的理由"},
    {"name": "老陈", "role": "同伴", "personality": "沉默寡言的退伍老兵，提供保护，但似乎藏着关于爆发起因的秘密"},
    {"name": "电波里的声音", "role": "神秘", "personality": "身份不明，偶尔切入你的频率，似乎知道得太多"}
  ],
  "initial_state": {"hp": 100, "物资": 5, "幸存者信任": 40, "理智": 75, "location": "电台·播音室", "装备": ["对讲机"]},
  "attributes": {
    "hp": {"type": "number", "initial": 100},
    "物资": {"type": "number", "initial": 5, "reveal": true},
    "幸存者信任": {"type": "number", "initial": 40, "reveal": true},
    "理智": {"type": "number", "initial": 75},
    "location": {"type": "scalar", "initial": "电台·播音室"},
    "装备": {"type": "set", "initial": ["对讲机"]}
  }
}`,
		},
		{
			CreatorID:   creatorID,
			Title:       "朔风记·雁门残刀",
			Description: "边关雁门，你是隐姓埋名的落魄剑客。十年前家门被灭，仇人如今执掌边军。一桩镖局血案，把你重新卷入江湖恩怨。",
			Status:      "published",
			PriceConfig: `{"type":"free"}`,
			WorldConfig: `{
  "theme": "ink",
  "tags": ["武侠仙侠", "复仇", "苍凉"],
  "background": "北境边关雁门。你本是名门之后，十年前满门被诬通敌而遭屠，唯你侥幸逃生，隐姓埋名以护镖为生。仇人如今已是执掌边军的都督裴烈。开春第一趟镖出关未久，镖队便在风雪隘口遭伏——而这桩血案，似乎与你的旧仇有关。",
  "style": "苍凉、快意恩仇、留白写意的武侠",
  "rules": "动武消耗内力，内力见底则招式使不出、需调息恢复；行事张扬会积累杀气（招致仇家察觉与旁人戒备，幕后暗涨）；侠名影响江湖人是否愿意相助或投靠；银两用于打点、疗伤、买马与情报；习得的武学可在对招时施展。",
  "outline": "核心:在复仇与放下之间，揭开十年前灭门案的真相。三幕:护镖遇伏、被卷入血案→在雁门内外结交或试探江湖各方、查明裴烈的布局→雪夜直闯都督府的最终对决。关键锚点:亡父留下的半卷《裂云刀谱》、镖局少主不为人知的身世、裴烈帐下一名与你同源的剑客。可能结局:手刃仇人却背上新的血债(bad)/揭破当年冤案、还家门清白全身而退(good)/归隐雪山成为江湖传说(hidden)。",
  "characters": [
    {"name": "云娘", "role": "镖局当家", "personality": "泼辣爽利、重情重义，镖旗下藏着自己的旧伤"},
    {"name": "沈孤鸿", "role": "亦敌亦友", "personality": "裴烈帐下冷面剑客，刀路竟与你同源，身世成谜"},
    {"name": "瞎眼说书人", "role": "神秘", "personality": "市井茶肆里的盲眼老者，似乎知晓十年前的每一桩旧事"}
  ],
  "initial_state": {"内力": 40, "银两": 8, "侠名": 0, "杀气": 0, "location": "雁门关·镖局大堂", "武学": ["裂云式·残"]},
  "attributes": {
    "内力": {"type": "number", "initial": 40},
    "银两": {"type": "number", "initial": 8},
    "侠名": {"type": "number", "initial": 0},
    "杀气": {"type": "number", "initial": 0, "hidden": true},
    "location": {"type": "scalar", "initial": "雁门关·镖局大堂"},
    "武学": {"type": "set", "initial": ["裂云式·残"]}
  }
}`,
		},
		{
			CreatorID:   creatorID,
			Title:       "义体黄昏·新九龙",
			Description: "2087年的赛博城寨，你是接黑活的义体黑客。一次委托出了岔子，脑内被植入一段不属于自己的记忆，企业的清道夫已经盯上你。",
			Status:      "published",
			PriceConfig: `{"type":"free"}`,
			WorldConfig: `{
  "theme": "sci",
  "tags": ["科幻", "赛博朋克", "悬疑"],
  "background": "2087年，霓虹与酸雨交织的新九龙城寨。你是接黑活的义体黑客。三天前一单侵入『苍穹生物』数据库的委托彻底翻车——你脑内被植入了一段不属于自己的记忆代码，而企业的清道夫已循着数据残迹找来。你在义肢黑医阿蛇的诊所里醒来，警报器正在城寨深处鸣响。",
  "style": "霓虹、赛博朋克、悬疑，道德灰色、节奏凌厉",
  "rules": "入侵与义体超频消耗神经负荷，过高会宕机、幻视甚至脑死；行动留下的数据痕迹会抬高企业警戒（幕后追踪度）；信用点用于买药、买情报、升级义体；安装的插件在对应场景生效；脑内那段记忆代码需要逐步解码才能看清。",
  "outline": "核心:查明脑内记忆代码是什么、它为何让企业不惜代价追杀你。三幕:带着代码在城寨逃亡、寻求庇护→在地下各方势力间周旋、逐段解码记忆→抉择:交出代码换命、公开真相撼动企业、还是独吞其价值。关键锚点:代码里一个『已死』女孩的记忆残片、阿蛇讳莫如深的过去、清道夫K的真实身份。可能结局:掀翻企业阴谋、成为都市传说(good)/被清道夫格式化(bad)/带着代码消失、化作网络里的新幽灵(hidden)。",
  "characters": [
    {"name": "阿蛇", "role": "义肢黑医", "personality": "油滑爱钱却讲义气，替你续命，也似乎认得那段代码"},
    {"name": "Null", "role": "神秘", "personality": "潜伏在网络深层的声音，时而援手时而戏弄，身份不明"},
    {"name": "清道夫K", "role": "追猎者", "personality": "企业豢养的猎杀者，冷酷高效，从不失手"}
  ],
  "initial_state": {"信用点": 200, "神经负荷": 0, "警戒": 0, "记忆碎片": 0, "location": "新九龙·阿蛇的诊所", "插件": ["基础入侵包"]},
  "attributes": {
    "信用点": {"type": "number", "initial": 200},
    "神经负荷": {"type": "number", "initial": 0},
    "警戒": {"type": "number", "initial": 0, "hidden": true},
    "记忆碎片": {"type": "number", "initial": 0, "reveal": true},
    "location": {"type": "scalar", "initial": "新九龙·阿蛇的诊所"},
    "插件": {"type": "set", "initial": ["基础入侵包"]}
  }
}`,
		},
		{
			CreatorID:   creatorID,
			Title:       "云屿·雾港邮局",
			Description: "一座漂在雾海里的小岛，有间只在起雾时营业的邮局，替人投递那些寄往『再也无法送达之处』的信。你成了新任邮差。",
			Status:      "published",
			PriceConfig: `{"type":"free"}`,
			WorldConfig: `{
  "theme": "heal",
  "tags": ["治愈日常", "奇幻", "慢节奏"],
  "background": "云屿是一座漂浮在茫茫雾海中的小岛。岛上有一间只在起雾时才亮灯的邮局，替人投递那些寄往『再也无法送达之处』的信——写给逝者、写给回不去的从前、写给还没说出口的心事。你阴差阳错成了这里的新任邮差；推开门的第一天，第一封无法投递的信，已在柜台上等你。",
  "style": "温柔、治愈、淡淡的奇幻与怅惘，慢节奏，重情感、倾听与选择（没有生命危险）",
  "rules": "每投出一封信，都会牵动你与某位岛民的羁绊，羁绊在你真正走进对方的故事后才建立；用心倾听与共情，人才愿把心事托付；你的心情会随际遇起落，心情太低时会看不清雾里的路；投递途中收集到的信物，各自承载一段往事。",
  "outline": "核心:在一封封『无法送达』的信里，走进岛民的遗憾，也解开邮局与雾海的温柔秘密。三幕:接手邮局、投出第一封信→在信件与信物中走进灯塔老人、离岛少年等人的过往→揭开前任邮差与雾海的真相，决定去留。关键锚点:前任邮差留下的一封始终没寄出的信、总在灯塔守望回音的老人、雾里偶尔飘来的钟声。可能结局:成为连接思念与释怀的摆渡人、让小岛重新有了灯火(good)/雾散人离、邮局归于沉寂(neutral)/寄出你自己那封信、随雾远行(hidden)。",
  "characters": [
    {"name": "阿雾", "role": "邮局的猫", "personality": "通人性的灰猫，会把你领到该去的门前"},
    {"name": "灯塔老人", "role": "岛民", "personality": "在灯塔上守了几十年，等一封也许永远不会来的回信"},
    {"name": "前任邮差", "role": "神秘", "personality": "只存在于信件与旁人只言片语里的身影，似乎从未真正离开"}
  ],
  "initial_state": {"心情": 60, "羁绊": 0, "思念": 0, "location": "云屿·雾港邮局", "信物": []},
  "attributes": {
    "心情": {"type": "number", "initial": 60},
    "羁绊": {"type": "number", "initial": 0, "reveal": true},
    "思念": {"type": "number", "initial": 0, "hidden": true},
    "location": {"type": "scalar", "initial": "云屿·雾港邮局"},
    "信物": {"type": "set", "initial": []}
  }
}`,
		},
	}
}
