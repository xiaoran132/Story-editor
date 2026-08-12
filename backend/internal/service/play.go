package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"backend/internal/model"
	"backend/internal/repository"
	"backend/pkg"

	"github.com/google/uuid"
)

// PlayService 编排「剧情游玩」核心链路：开局 → 选择 → 生成 → 更新属性 → 回溯。
type PlayService struct {
	sessions *repository.PlaySessionRepository
	nodes    *repository.NodeRepository
	stories  StoryReader // 跨模块只读 story，经窄接口而非直接依赖 story repo（拆分接缝）
	ai       *AgentClient
	resolver *LLMResolver   // BYOK：按玩家 write/review 环节解析下发配置
	credit   *CreditService // 平台额度扣费（只对走平台档的环节生效）
}

func NewPlayService(
	sessions *repository.PlaySessionRepository,
	nodes *repository.NodeRepository,
	stories StoryReader,
	ai *AgentClient,
	resolver *LLMResolver,
	credit *CreditService,
) *PlayService {
	return &PlayService{
		sessions: sessions, nodes: nodes, stories: stories,
		ai: ai, resolver: resolver, credit: credit,
	}
}

// resolvePlay 解析某玩家在某作品下的 write + review 下发配置（用于开场/续写）。
//
// **解析不到 write 就是硬失败**：agent 已无任何默认凭据，发过去只会换来一个
// 难读的内部错误；在这里失败才能给玩家一句能照着做的话。
//
// review 只在该作品的开关打开时解析。开关关着 → 返回 nil，agent 整段跳过审校
// （省一半 token）。开关开着却解析不到 → 也报错：那是配置错误，不是可降级项，
// 静默降级会让玩家以为审校在生效。
func (s *PlayService) resolvePlay(ctx context.Context, playerID, storyID uuid.UUID) (write, review *AgentLLMConfig, err error) {
	if s.resolver == nil {
		return nil, nil, noLLMConfigErr()
	}
	// 存储故障原样上抛（resolver 已区分「查库失败」与「没配置」）：
	// 把 DB 抖动说成「你没配模型」，玩家会照着去配一遍，然后发现还是不行。
	write, err = s.resolver.ResolveForPlay(ctx, playerID, storyID, StageWrite)
	if err != nil {
		return nil, nil, err
	}
	if write == nil {
		return nil, nil, noLLMConfigErr()
	}
	reviewOn, err := s.resolver.ReviewEnabled(ctx, playerID, storyID)
	if err != nil {
		return nil, nil, err
	}
	if !reviewOn {
		return write, nil, nil
	}
	review, err = s.resolver.ResolveForPlay(ctx, playerID, storyID, StageReview)
	if err != nil {
		return nil, nil, err
	}
	if review == nil {
		return nil, nil, pkg.NewBusinessErrorWithMessage(pkg.CodeNoLLMConfig,
			"你为本作品开启了质量审校，但没有为它选择模型连接。请在作品详情页的「生成设置」里补上，或关闭审校。")
	}
	return write, review, nil
}

// noLLMConfigErr 是"没有可用模型"的统一文案。放一处，免得三个调用点各写一句。
func noLLMConfigErr() error {
	return pkg.NewBusinessErrorWithMessage(pkg.CodeNoLLMConfig,
		"没有可用的模型：平台赠送额度已用尽或未开放。请在「个人主页 → AI 连接」添加你自己的模型连接，再回来游玩。")
}

// SessionResult 是游玩接口返回的组合 DTO：会话 + 当前节点（+ 可选整局节点列表）。
type SessionResult struct {
	Session     *model.SessionResponse `json:"session"`
	CurrentNode *model.NodeResponse    `json:"current_node"`
	Nodes       []model.NodeResponse   `json:"nodes,omitempty"`
	// ReadOnly：作品被作者取消发布，这一局只能读完、不能再推进（引用模式的下架语义）。
	// 前端据此禁用选项与自由输入；不给这个标志的话，玩家只能靠点下去撞一个 403 才知道。
	ReadOnly bool `json:"read_only"`
}

// StartSession 开始一局：只建**空会话**（无根节点），开场正文改由 StartOpeningStream 流式生成。
// 这样开局正文也能像续写一样逐字流到浏览器（生成发生在游玩页而非首页建会话时）。
func (s *PlayService) StartSession(playerID, storyID uuid.UUID) (*SessionResult, error) {
	ctx := context.Background()

	story, err := s.stories.FindByID(ctx, storyID)
	if err != nil {
		return nil, err
	}
	if err := canPlay(story, playerID); err != nil {
		return nil, err
	}

	world := parseWorld(story.WorldConfig)
	initialState := world.InitialState
	if initialState == nil {
		initialState = map[string]any{}
	}

	session := &model.PlaySession{
		StoryID:       storyID,
		PlayerID:      playerID,
		CurrentState:  dumpState(initialState), // 开局前 current_state 即初始值
		RevealedAttrs: "[]",                    // 门控属性开局均未揭示（非门控属性不入此集、始终可见）
		Status:        "active",
		NodeCount:     0,
		LastPlayedAt:  time.Now(),
	}
	if err := s.sessions.Create(ctx, session); err != nil {
		return nil, err
	}
	// CurrentNode 为 nil：前端游玩页据此触发 StartOpeningStream 流式生成开场。
	return newAttrView(world, story.CreatorID == playerID).result(session, nil), nil
}

// streamFixedText 把一段固定正文按小块 + 微延时逐块回调，模拟 LLM 逐字流式的观感。
// 仅用于预设 opening_content（本无 token 流）；按 rune 切分避免截断多字节字符。
func streamFixedText(text string, onDelta func(string)) {
	if onDelta == nil || text == "" {
		return
	}
	const chunk = 3                        // 每帧字符数
	const pace = 30 * time.Millisecond     // 每帧间隔
	runes := []rune(text)
	for i := 0; i < len(runes); i += chunk {
		end := i + chunk
		if end > len(runes) {
			end = len(runes)
		}
		onDelta(string(runes[i:end]))
		time.Sleep(pace)
	}
}

// StartOpeningStream 为空会话流式生成开场并落根节点：正文增量经 onDelta 外发，结束落库。
// 幂等：若根节点已存在（刷新/重复触发），直接返回既有开场，不重复生成。
func (s *PlayService) StartOpeningStream(
	sessionID, playerID uuid.UUID, onDelta func(string), onRevise func(),
) (*SessionResult, error) {
	ctx := context.Background()

	session, err := s.sessions.FindByID(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return nil, pkg.NotFound("session not found")
	}
	if err := checkSessionOwner(session, playerID); err != nil {
		return nil, err
	}
	if session.CurrentNodeID != nil { // 幂等：开场已生成，直接返回
		return s.GetSession(playerID, sessionID)
	}

	story, err := s.stories.FindByID(ctx, session.StoryID)
	if err != nil {
		return nil, err
	}
	if canPlay(story, playerID) != nil {
		return nil, readOnlyErr() // 建会话后作品被取消发布：开场也是生成，一并拦下
	}
	world := parseWorld(story.WorldConfig)
	initialState := parseState(session.CurrentState)
	write, review, err := s.resolvePlay(ctx, playerID, session.StoryID)
	if err != nil {
		return nil, err // 没有可用模型：在开流生成之前就说清楚，别让玩家白等
	}

	// 生成开场：预设 opening_content 的作品正文固定（直接作为一帧 delta 外发，再补选项/摘要）；
	// 否则走 agent 流式真生成。
	var opening *AIResult
	if story.OpeningContent != "" {
		// 预设正文固定、无 LLM token 流：按小块 + 微延时模拟打字机，
		// 给出与续写一致的逐字流式观感（否则整段瞬显，等于没流式）。
		streamFixedText(story.OpeningContent, onDelta)
		opening, err = s.ai.CompleteOpening(ctx, world, initialState, story.OpeningContent, write)
		if err != nil {
			opening = &AIResult{Content: story.OpeningContent, Options: []Option{}, StateDelta: map[string]any{}}
		} else {
			opening.Content = story.OpeningContent
		}
	} else {
		opening, err = s.ai.StartStoryStream(ctx, world, initialState, parseStrList(session.RevealedAttrs), write, review, onDelta, onRevise)
		if err != nil {
			return nil, pkg.Internal("ai start story stream: " + err.Error())
		}
	}

	// 扣平台额度（只对确实走了平台档的环节生效；玩家自带 key 不动额度）。
	s.credit.ChargeAll(ctx, playerID, &session.StoryID, write, review, opening.Usage)

	// 开场揭示（若 AI 在开场即揭示某门控属性）：并入会话与根节点快照。
	revealedJSON := mergeRevealed(session.RevealedAttrs, opening.Revealed, world.RevealGatedAttrs())

	root := &model.StoryNode{
		StoryID:          session.StoryID,
		SessionID:        session.ID,
		ParentID:         nil,
		Depth:            0,
		Content:          opening.Content,
		Summary:          opening.Summary,
		SuggestedOptions: dumpAny(opening.Options),
		StateDelta:       "{}",
		StateSnapshot:    dumpState(initialState),
		RevealedSnapshot: revealedJSON,
	}
	session.NodeCount = 1
	session.RevealedAttrs = revealedJSON
	session.LastPlayedAt = time.Now()
	// 跨表事务下沉到仓储：Create(root) + 会话指向根节点（CurrentNodeID 由仓储回填后设置）。
	if err := s.sessions.CreateNodeAndUpdateSession(ctx, root, session); err != nil {
		return nil, err
	}
	return newAttrView(world, story.CreatorID == playerID).result(session, root), nil
}

// loadChoiceContext 校验会话并回溯出 AI 上下文（当前节点到根的路径 + history）。
// MakeChoice 与 MakeChoiceStream 的前置阶段一致，抽出复用。
// 返回 story 而非解析好的 WorldConfig：下游既要 world（合并属性）又要 CreatorID（判断
// 是不是作者本人、决定要不要脱敏），拆成两个返回值不如直接给源。
func (s *PlayService) loadChoiceContext(ctx context.Context, sessionID, playerID uuid.UUID) (
	*model.PlaySession, *model.Story, []model.StoryNode, []PathStep, error,
) {
	session, err := s.sessions.FindByID(ctx, sessionID)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	if session == nil {
		return nil, nil, nil, nil, pkg.NotFound("session not found")
	}
	if err := checkSessionOwner(session, playerID); err != nil {
		return nil, nil, nil, nil, err
	}
	if session.Status != "active" {
		return nil, nil, nil, nil, pkg.BadRequest("session already ended")
	}
	if session.CurrentNodeID == nil {
		return nil, nil, nil, nil, pkg.BadRequest("session has no current node")
	}

	story, err := s.stories.FindByID(ctx, session.StoryID)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	// 归属校验之外还要看作品状态：作者取消发布后，其他人的既有会话可以读完，但不能再推进。
	if canPlay(story, playerID) != nil {
		return nil, nil, nil, nil, readOnlyErr()
	}

	pathNodes, err := s.nodes.FindPath(ctx, *session.CurrentNodeID)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	history := make([]PathStep, 0, len(pathNodes))
	for _, n := range pathNodes {
		step := PathStep{Content: n.Content, Summary: n.Summary}
		if n.ChoiceText != nil {
			step.ChoiceText = *n.ChoiceText
		}
		history = append(history, step)
	}
	return session, story, pathNodes, history, nil
}

// applyContinueResult 消费一次续写生成结果：状态合并 → 同层语义去重 → 建节点/复用 + 更新会话。
// 非流式与流式共用（区别仅在生成阶段；落库阶段依赖完整结果，两者一致）。
func (s *PlayService) applyContinueResult(
	ctx context.Context, session *model.PlaySession, pathNodes []model.StoryNode,
	story *model.Story, choice string, result *AIResult,
) (*SessionResult, error) {
	world := parseWorld(story.WorldConfig)
	view := newAttrView(world, story.CreatorID == session.PlayerID)
	currentState := parseState(session.CurrentState)
	newState := mergeState(currentState, result.StateDelta, world.AttrTypes())
	// 揭示集合：把本段新揭示的门控属性并入会话已揭示集（仅保留声明为门控的键）。
	revealedJSON := mergeRevealed(session.RevealedAttrs, result.Revealed, world.RevealGatedAttrs())

	// 生成后去重：若新选择与当前节点的某个已有直接子节点「状态变化相同 + 语义等价」，
	// 复用该子节点而不新建，避免近义选择（如“冲进衣帽间”/“冲到衣帽间内”）污染剧情树。
	if merged, err := s.tryMerge(ctx, *session.CurrentNodeID, choice, result); err == nil && merged != nil {
		session.CurrentNodeID = &merged.ID
		session.CurrentState = merged.StateSnapshot     // delta 与父状态一致，快照等价
		session.RevealedAttrs = merged.RevealedSnapshot // 揭示状态同步到复用节点快照
		session.LastPlayedAt = time.Now()
		if merged.IsEnding {
			session.Status = "ended"
		}
		if err := s.sessions.Update(ctx, session); err != nil {
			return nil, err
		}
		return view.result(session, merged), nil
	}

	parentID := *session.CurrentNodeID
	choiceText := choice
	node := &model.StoryNode{
		StoryID:          session.StoryID,
		SessionID:        session.ID,
		ParentID:         &parentID,
		Depth:            len(pathNodes), // 根 depth=0，路径长度即新节点深度
		ChoiceText:       &choiceText,
		Content:          result.Content,
		Summary:          result.Summary,
		SuggestedOptions: dumpAny(result.Options),
		StateDelta:       dumpState(result.StateDelta),
		StateSnapshot:    dumpState(newState),
		RevealedSnapshot: revealedJSON,
		IsEnding:         result.IsEnding,
	}
	if result.IsEnding && result.EndingType != "" {
		node.EndingType = &result.EndingType
	}

	// 事务：写子节点 + 更新会话状态（唯一事实来源 current_state）。CurrentNodeID 由仓储回填后设置。
	session.CurrentState = dumpState(newState)
	session.RevealedAttrs = revealedJSON
	session.NodeCount++
	session.LastPlayedAt = time.Now()
	if result.IsEnding {
		session.Status = "ended"
	}
	if err := s.sessions.CreateNodeAndUpdateSession(ctx, node, session); err != nil {
		return nil, err
	}
	return view.result(session, node), nil
}

// MakeChoiceStream 提交一次选择（流式）：回溯历史 → AI 流式生成（正文增量经 onDelta 外发、
// 审校拒绝经 onRevise 通知）→ 流结束拿到完整结果后合并属性/去重/写子节点/更新会话。
func (s *PlayService) MakeChoiceStream(
	sessionID, playerID uuid.UUID, choice string, onDelta func(string), onRevise func(),
) (*SessionResult, error) {
	ctx := context.Background()
	session, story, pathNodes, history, err := s.loadChoiceContext(ctx, sessionID, playerID)
	if err != nil {
		return nil, err
	}
	world := parseWorld(story.WorldConfig)
	currentState := parseState(session.CurrentState)
	write, review, err := s.resolvePlay(ctx, playerID, session.StoryID)
	if err != nil {
		return nil, err
	}
	result, err := s.ai.ContinueStream(ctx, world, history, currentState, choice, parseStrList(session.RevealedAttrs), write, review, onDelta, onRevise)
	if err != nil {
		return nil, pkg.Internal("ai continue stream: " + err.Error())
	}
	// 扣平台额度：token 已经烧掉了，所以无论后续落库成功与否都要记账。
	s.credit.ChargeAll(ctx, playerID, &session.StoryID, write, review, result.Usage)
	return s.applyContinueResult(ctx, session, pathNodes, story, choice, result)
}

// tryMerge 在当前节点的已有直接子节点中，寻找与本次生成「state_delta 相同 + 语义等价」的一个复用。
// 先按 delta 相等硬过滤（省掉 AI 调用），再对候选调 agent 判语义；命中返回该子节点，否则 (nil, nil)。
func (s *PlayService) tryMerge(ctx context.Context, parentID uuid.UUID, choice string, result *AIResult) (*model.StoryNode, error) {
	children, err := s.nodes.FindChildren(ctx, parentID)
	if err != nil {
		return nil, err
	}
	if len(children) == 0 {
		return nil, nil
	}

	newDelta := dumpState(result.StateDelta) // 与子节点 StateDelta 同出 dumpState，键有序可比
	var candidates []MergeCandidate
	var candIdx []int // candidates[i] 对应 children 的下标
	for i := range children {
		if deltaEqual(children[i].StateDelta, newDelta) {
			ct := ""
			if children[i].ChoiceText != nil {
				ct = *children[i].ChoiceText
			}
			candidates = append(candidates, MergeCandidate{ChoiceText: ct, Content: children[i].Content})
			candIdx = append(candIdx, i)
		}
	}
	if len(candidates) == 0 {
		return nil, nil
	}

	matched, err := s.ai.CheckMerge(ctx, choice, result.Content, candidates)
	if err != nil {
		return nil, err // 判定失败：不合并，交由调用方走新建
	}
	if matched < 0 {
		return nil, nil
	}
	return &children[candIdx[matched]], nil
}

// deltaEqual 比较两个 state_delta 的规范 JSON 是否相等。
// 两侧都出自 dumpState（map[string]any → 键有序的 JSON），值相等则字符串相等；
// 为兜底格式差异（如 {} 与空串），再做一次解析后的 JSON 规范化比较。
func deltaEqual(stored, fresh string) bool {
	if stored == fresh {
		return true
	}
	return dumpState(parseState(stored)) == dumpState(parseState(fresh))
}

// Backtrack 回溯到某历史节点：不删数据，恢复该节点的状态快照，从该点继续分叉。
func (s *PlayService) Backtrack(playerID, sessionID, nodeID uuid.UUID) (*SessionResult, error) {
	ctx := context.Background()

	session, err := s.sessions.FindByID(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return nil, pkg.NotFound("session not found")
	}
	if err := checkSessionOwner(session, playerID); err != nil {
		return nil, err
	}

	node, err := s.nodes.FindByID(ctx, nodeID)
	if err != nil {
		return nil, err
	}
	if node == nil || node.SessionID != session.ID {
		return nil, pkg.NotFound("node not found in this session")
	}

	// 闸要在写库**之前**：回溯不生成内容，但它改写 current_node_id / current_state /
	// revealed_attrs，是货真价实的写入，只读的局不能做。
	view, playable, err := s.storyGate(ctx, session)
	if err != nil {
		return nil, err
	}
	if !playable {
		return nil, readOnlyErr()
	}

	session.CurrentNodeID = &node.ID
	session.CurrentState = node.StateSnapshot
	session.RevealedAttrs = node.RevealedSnapshot // 回溯同时恢复"已揭示"可见性（发现前的节点会重新隐藏）
	session.Status = "active"                     // 回到旧节点则重新激活
	session.LastPlayedAt = time.Now()
	if err := s.sessions.Update(ctx, session); err != nil {
		return nil, err
	}

	return view.result(session, node), nil
}

// storyGate 为「读」路径（GetSession/Backtrack）取一次作品，回答两件事：
// 该玩家的属性可见性，以及**现在还能不能推进**。
//
// 下架不拦读：作者取消发布后，别人玩到一半的那一局可以读完，只是不能再生成新节点
// （引用模式语义）。只有作品行真的没了才 404——那时也确实没什么可读的。
func (s *PlayService) storyGate(ctx context.Context, session *model.PlaySession) (attrView, bool, error) {
	story, err := s.stories.FindByID(ctx, session.StoryID)
	if err != nil {
		return attrView{}, false, err
	}
	if story == nil {
		return attrView{}, false, pkg.NotFound("story not found")
	}
	isAuthor := story.CreatorID == session.PlayerID
	return newAttrView(parseWorld(story.WorldConfig), isAuthor), canPlay(story, session.PlayerID) == nil, nil
}

// DeleteSession 删除一局游玩会话及其全部节点（读档列表删档）。
// 归属校验与列表口径一致：仅允许删除自己（当前匿名回退 guest）名下的会话。
func (s *PlayService) DeleteSession(playerID, sessionID uuid.UUID) error {
	ctx := context.Background()

	session, err := s.sessions.FindByID(ctx, sessionID)
	if err != nil {
		return err
	}
	if session == nil {
		return pkg.NotFound("session not found")
	}
	if err := checkSessionOwner(session, playerID); err != nil {
		return err
	}

	return s.sessions.DeleteSessionCascade(ctx, sessionID)
}

// checkSessionOwner 校验会话归属：会话的 PlayerID 必须等于调用者，否则 403。
// 抽成纯函数便于单测（不依赖 DB）。所有按 sessionID 访问他人会话的入口共用它。
func checkSessionOwner(session *model.PlaySession, playerID uuid.UUID) error {
	return requireOwner(session.PlayerID, playerID)
}

// GetSession 返回会话 + 当前节点 + 该局全部节点（供时间线渲染）。
func (s *PlayService) GetSession(playerID, sessionID uuid.UUID) (*SessionResult, error) {
	ctx := context.Background()

	session, err := s.sessions.FindByID(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return nil, pkg.NotFound("session not found")
	}
	if err := checkSessionOwner(session, playerID); err != nil {
		return nil, err
	}

	view, playable, err := s.storyGate(ctx, session)
	if err != nil {
		return nil, err
	}

	var current *model.NodeResponse
	if session.CurrentNodeID != nil {
		node, err := s.nodes.FindByID(ctx, *session.CurrentNodeID)
		if err != nil {
			return nil, err
		}
		if node != nil {
			current = view.node(node)
		}
	}

	// 整局节点也要逐节点脱敏——时间线是最容易被忽略的泄露口：
	// 会话当前值挡住了，历史节点快照却把同一个数原样摆在那里。
	nodes, err := s.nodes.FindBySessionID(ctx, session.ID)
	if err != nil {
		return nil, err
	}
	responses := make([]model.NodeResponse, 0, len(nodes))
	for i := range nodes {
		responses = append(responses, *view.node(&nodes[i]))
	}

	return &SessionResult{
		Session:     view.session(session),
		CurrentNode: current,
		Nodes:       responses,
		ReadOnly:    !playable,
	}, nil
}

// SessionListItem 是读档列表项：会话摘要 + 作品标题（便于前端直接展示）。
type SessionListItem struct {
	*model.SessionResponse
	StoryTitle string `json:"story_title"`
	// Available=false 表示这局现在进不去了（作品被作者取消发布或删除）。
	// 仍然列出来而不是悄悄消失——存档是玩家自己的东西，凭空少一条比标注「已下架」更让人困惑。
	Available bool `json:"available"`
}

// ListSessions 列出某玩家的全部会话（含作品标题），按最近游玩时间倒序。
func (s *PlayService) ListSessions(playerID uuid.UUID) ([]SessionListItem, error) {
	ctx := context.Background()

	sessions, err := s.sessions.FindByPlayerID(ctx, playerID)
	if err != nil {
		return nil, err
	}

	// 缓存作品的标题 + 可见性，避免同一作品重复查询。
	type storyMeta struct {
		title     string
		view      attrView
		available bool // 作品仍可读可玩（取不到 / 已取消发布 → false）
	}
	cache := map[uuid.UUID]storyMeta{}
	items := make([]SessionListItem, 0, len(sessions))
	for i := range sessions {
		sess := &sessions[i]
		meta, ok := cache[sess.StoryID]
		if !ok {
			if story, err := s.stories.FindByID(ctx, sess.StoryID); err == nil && story != nil {
				// 标题照给：玩家玩过这部作品，凭标题才认得出是哪一局；下架与否不改变这点。
				meta.title = story.Title
				if canPlay(story, playerID) == nil {
					meta.view = newAttrView(parseWorld(story.WorldConfig), story.CreatorID == playerID)
					meta.available = true
				}
			}
			cache[sess.StoryID] = meta
		}
		resp := meta.view.session(sess)
		if !meta.available {
			// 进不去的局也不外发状态：宁可整份留空，也不赌这部作品没有隐藏属性。
			// 列表只用标题和时间，无损。
			resp.CurrentState = "{}"
		}
		items = append(items, SessionListItem{
			SessionResponse: resp,
			StoryTitle:      meta.title,
			Available:       meta.available,
		})
	}
	return items, nil
}

// ----- 状态解析/合并辅助 -----

func parseWorld(raw string) WorldConfig {
	var w WorldConfig
	if raw == "" {
		return w
	}
	_ = json.Unmarshal([]byte(raw), &w)
	return w
}

func parseState(raw string) map[string]any {
	m := map[string]any{}
	if raw == "" {
		return m
	}
	_ = json.Unmarshal([]byte(raw), &m)
	return m
}

func dumpState(m map[string]any) string {
	if m == nil {
		return "{}"
	}
	raw, err := json.Marshal(m)
	if err != nil {
		return "{}"
	}
	return string(raw)
}

func dumpAny(v any) string {
	raw, err := json.Marshal(v)
	if err != nil {
		return "[]"
	}
	return string(raw)
}

// parseStrList 解析存为 JSON 数组字符串的键集（如 revealed_attrs）。
func parseStrList(raw string) []string {
	if raw == "" {
		return nil
	}
	var out []string
	_ = json.Unmarshal([]byte(raw), &out)
	return out
}

// mergeRevealed 把本段新揭示的键（仅保留声明为「揭示门控」的）并入已揭示集合，
// 返回有序 JSON 数组字符串（有序保证可比、快照稳定）。
func mergeRevealed(existing string, fresh []string, gated map[string]bool) string {
	set := map[string]bool{}
	for _, k := range parseStrList(existing) {
		set[k] = true
	}
	for _, k := range fresh {
		if gated[k] {
			set[k] = true
		}
	}
	keys := make([]string, 0, len(set))
	for k := range set {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	raw, err := json.Marshal(keys)
	if err != nil {
		return "[]"
	}
	return string(raw)
}

// mergeState 按属性类型应用增量：
//   - number：数值累加
//   - scalar：新值覆盖
//   - set：对当前列表按 {add, remove} 增删（去重）
//   - 未声明类型：沿用推断——两侧皆数值则累加，否则覆盖（向后兼容无 attributes 的老作品）
//
// types 由 WorldConfig.AttrTypes() 提供；仅显式声明的键有类型。
func mergeState(current, delta map[string]any, types map[string]string) map[string]any {
	out := make(map[string]any, len(current))
	for k, v := range current {
		out[k] = v
	}
	for k, dv := range delta {
		switch types[k] {
		case "number":
			out[k] = addNumeric(out[k], dv)
		case "scalar":
			out[k] = dv
		case "set":
			out[k] = applySet(out[k], dv)
		default:
			// 未声明：数值累加，否则覆盖
			if cf, okc := toFloat(out[k]); okc {
				if df, okd := toFloat(dv); okd {
					out[k] = cf + df
					continue
				}
			}
			out[k] = dv
		}
	}
	return out
}

// addNumeric 累加数值增量；原值缺失或非数值时取增量本身作为初值。
func addNumeric(cur, dv any) any {
	df, okd := toFloat(dv)
	if !okd {
		return dv // 非数值兜底覆盖（正常已被 Python normalize 过滤）
	}
	if cf, okc := toFloat(cur); okc {
		return cf + df
	}
	return df
}

// applySet 对集合属性应用 {add, remove}：先按 remove 剔除，再并入 add，保持去重与顺序。
func applySet(cur, dv any) any {
	m, ok := dv.(map[string]any)
	if !ok {
		return cur // 非预期格式（Python 已规整为 {add,remove}），保持不变
	}
	remove := map[string]bool{}
	for _, x := range toAnyList(m["remove"]) {
		remove[fmt.Sprint(x)] = true
	}

	result := make([]any, 0)
	seen := map[string]bool{}
	push := func(x any) {
		key := fmt.Sprint(x)
		if seen[key] {
			return
		}
		seen[key] = true
		result = append(result, x)
	}
	for _, x := range toAnyList(cur) {
		if remove[fmt.Sprint(x)] {
			continue
		}
		push(x)
	}
	for _, x := range toAnyList(m["add"]) {
		push(x) // add 优先：与 remove 同时出现时以“加入”为最终态
	}
	return result
}

func toAnyList(v any) []any {
	if l, ok := v.([]any); ok {
		return l
	}
	return nil
}

func toFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}
