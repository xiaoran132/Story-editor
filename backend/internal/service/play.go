package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"backend/internal/model"
	"backend/internal/repository"
	"backend/pkg"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// PlayService 编排「剧情游玩」核心链路：开局 → 选择 → 生成 → 更新属性 → 回溯。
type PlayService struct {
	sessions *repository.PlaySessionRepository
	nodes    *repository.NodeRepository
	stories  *repository.StoryRepository
	ai       *AgentClient
}

func NewPlayService(
	sessions *repository.PlaySessionRepository,
	nodes *repository.NodeRepository,
	stories *repository.StoryRepository,
	ai *AgentClient,
) *PlayService {
	return &PlayService{sessions: sessions, nodes: nodes, stories: stories, ai: ai}
}

// SessionResult 是游玩接口返回的组合 DTO：会话 + 当前节点（+ 可选整局节点列表）。
type SessionResult struct {
	Session     *model.SessionResponse `json:"session"`
	CurrentNode *model.NodeResponse    `json:"current_node"`
	Nodes       []model.NodeResponse   `json:"nodes,omitempty"`
}

// StartSession 开始一局：解析世界观 → 建会话 → AI 生成开场 → 建根节点。
func (s *PlayService) StartSession(playerID, storyID uuid.UUID) (*SessionResult, error) {
	ctx := context.Background()

	story, err := s.stories.FindByID(ctx, storyID)
	if err != nil {
		return nil, err
	}
	if story == nil {
		return nil, pkg.NotFound("story not found")
	}

	world := parseWorld(story.WorldConfig)
	initialState := world.InitialState
	if initialState == nil {
		initialState = map[string]any{}
	}

	// 生成开场：优先用作品预设的 opening_content，否则调 AI。
	var opening *AIResult
	if story.OpeningContent != "" {
		opening = &AIResult{Content: story.OpeningContent, Options: []Option{}, StateDelta: map[string]any{}}
	} else {
		opening, err = s.ai.StartStory(ctx, world, initialState)
		if err != nil {
			return nil, pkg.Internal("ai start story: " + err.Error())
		}
	}

	session := &model.PlaySession{
		StoryID:      storyID,
		PlayerID:     playerID,
		CurrentState: dumpState(initialState),
		Status:       "active",
		LastPlayedAt: time.Now(),
	}
	root := &model.StoryNode{
		StoryID:          storyID,
		ParentID:         nil,
		Depth:            0,
		Content:          opening.Content,
		Summary:          opening.Summary,
		SuggestedOptions: dumpAny(opening.Options),
		StateDelta:       "{}",
		StateSnapshot:    dumpState(initialState),
	}

	// 事务：建会话 + 建根节点 + 回填 current_node_id。
	err = s.sessions.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(session).Error; err != nil {
			return err
		}
		root.SessionID = session.ID
		if err := tx.Create(root).Error; err != nil {
			return err
		}
		session.CurrentNodeID = &root.ID
		session.NodeCount = 1
		return tx.Save(session).Error
	})
	if err != nil {
		return nil, err
	}

	return &SessionResult{Session: session.ToResponse(), CurrentNode: root.ToResponse()}, nil
}

// MakeChoice 提交一次选择：回溯历史 → AI 生成 → 合并属性 → 写子节点 + 更新会话。
func (s *PlayService) MakeChoice(sessionID uuid.UUID, choice string) (*SessionResult, error) {
	ctx := context.Background()

	session, err := s.sessions.FindByID(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return nil, pkg.NotFound("session not found")
	}
	if session.Status != "active" {
		return nil, pkg.BadRequest("session already ended")
	}
	if session.CurrentNodeID == nil {
		return nil, pkg.BadRequest("session has no current node")
	}

	story, err := s.stories.FindByID(ctx, session.StoryID)
	if err != nil {
		return nil, err
	}
	if story == nil {
		return nil, pkg.NotFound("story not found")
	}
	world := parseWorld(story.WorldConfig)

	// 回溯当前节点到根的完整路径，构建 AI 上下文。
	pathNodes, err := s.nodes.FindPath(ctx, *session.CurrentNodeID)
	if err != nil {
		return nil, err
	}
	history := make([]PathStep, 0, len(pathNodes))
	for _, n := range pathNodes {
		step := PathStep{Content: n.Content, Summary: n.Summary}
		if n.ChoiceText != nil {
			step.ChoiceText = *n.ChoiceText
		}
		history = append(history, step)
	}

	currentState := parseState(session.CurrentState)
	result, err := s.ai.Continue(ctx, world, history, currentState, choice)
	if err != nil {
		return nil, pkg.Internal("ai continue: " + err.Error())
	}

	newState := mergeState(currentState, result.StateDelta, world.AttrTypes())

	// 生成后去重：若新选择与当前节点的某个已有直接子节点「状态变化相同 + 语义等价」，
	// 复用该子节点而不新建，避免近义选择（如“冲进衣帽间”/“冲到衣帽间内”）污染剧情树。
	if merged, err := s.tryMerge(ctx, *session.CurrentNodeID, choice, result); err == nil && merged != nil {
		session.CurrentNodeID = &merged.ID
		session.CurrentState = merged.StateSnapshot // delta 与父状态一致，快照等价
		session.LastPlayedAt = time.Now()
		if merged.IsEnding {
			session.Status = "ended"
		}
		if err := s.sessions.Update(ctx, session); err != nil {
			return nil, err
		}
		return &SessionResult{Session: session.ToResponse(), CurrentNode: merged.ToResponse()}, nil
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
		IsEnding:         result.IsEnding,
	}
	if result.IsEnding && result.EndingType != "" {
		node.EndingType = &result.EndingType
	}

	// 事务：写子节点 + 更新会话状态（唯一事实来源 current_state）。
	err = s.sessions.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(node).Error; err != nil {
			return err
		}
		session.CurrentState = dumpState(newState)
		session.CurrentNodeID = &node.ID
		session.NodeCount++
		session.LastPlayedAt = time.Now()
		if result.IsEnding {
			session.Status = "ended"
		}
		return tx.Save(session).Error
	})
	if err != nil {
		return nil, err
	}

	return &SessionResult{Session: session.ToResponse(), CurrentNode: node.ToResponse()}, nil
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
func (s *PlayService) Backtrack(sessionID, nodeID uuid.UUID) (*SessionResult, error) {
	ctx := context.Background()

	session, err := s.sessions.FindByID(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return nil, pkg.NotFound("session not found")
	}

	node, err := s.nodes.FindByID(ctx, nodeID)
	if err != nil {
		return nil, err
	}
	if node == nil || node.SessionID != session.ID {
		return nil, pkg.NotFound("node not found in this session")
	}

	session.CurrentNodeID = &node.ID
	session.CurrentState = node.StateSnapshot
	session.Status = "active" // 回到旧节点则重新激活
	session.LastPlayedAt = time.Now()
	if err := s.sessions.Update(ctx, session); err != nil {
		return nil, err
	}

	return &SessionResult{Session: session.ToResponse(), CurrentNode: node.ToResponse()}, nil
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
	if session.PlayerID != playerID {
		return pkg.Forbidden("cannot delete another player's session")
	}

	// 事务：先删该局全部节点，再删会话行（模型无外键，级联手动处理）。
	return s.sessions.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("session_id = ?", sessionID).Delete(&model.StoryNode{}).Error; err != nil {
			return err
		}
		return tx.Delete(&model.PlaySession{}, "id = ?", sessionID).Error
	})
}

// GetSession 返回会话 + 当前节点 + 该局全部节点（供时间线渲染）。
func (s *PlayService) GetSession(sessionID uuid.UUID) (*SessionResult, error) {
	ctx := context.Background()

	session, err := s.sessions.FindByID(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return nil, pkg.NotFound("session not found")
	}

	var current *model.NodeResponse
	if session.CurrentNodeID != nil {
		node, err := s.nodes.FindByID(ctx, *session.CurrentNodeID)
		if err != nil {
			return nil, err
		}
		if node != nil {
			current = node.ToResponse()
		}
	}

	nodes, err := s.nodes.FindBySessionID(ctx, session.ID)
	if err != nil {
		return nil, err
	}
	responses := make([]model.NodeResponse, 0, len(nodes))
	for i := range nodes {
		responses = append(responses, *nodes[i].ToResponse())
	}

	return &SessionResult{
		Session:     session.ToResponse(),
		CurrentNode: current,
		Nodes:       responses,
	}, nil
}

// SessionListItem 是读档列表项：会话摘要 + 作品标题（便于前端直接展示）。
type SessionListItem struct {
	*model.SessionResponse
	StoryTitle string `json:"story_title"`
}

// ListSessions 列出某玩家的全部会话（含作品标题），按最近游玩时间倒序。
func (s *PlayService) ListSessions(playerID uuid.UUID) ([]SessionListItem, error) {
	ctx := context.Background()

	sessions, err := s.sessions.FindByPlayerID(ctx, playerID)
	if err != nil {
		return nil, err
	}

	// 缓存作品标题，避免同一作品重复查询。
	titles := map[uuid.UUID]string{}
	items := make([]SessionListItem, 0, len(sessions))
	for i := range sessions {
		sess := &sessions[i]
		title, ok := titles[sess.StoryID]
		if !ok {
			if story, err := s.stories.FindByID(ctx, sess.StoryID); err == nil && story != nil {
				title = story.Title
			}
			titles[sess.StoryID] = title
		}
		items = append(items, SessionListItem{
			SessionResponse: sess.ToResponse(),
			StoryTitle:      title,
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
