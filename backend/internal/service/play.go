package service

import (
	"context"
	"encoding/json"
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
	ai       *AIClient
}

func NewPlayService(
	sessions *repository.PlaySessionRepository,
	nodes *repository.NodeRepository,
	stories *repository.StoryRepository,
	ai *AIClient,
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
		step := PathStep{Content: n.Content}
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

	newState := mergeState(currentState, result.StateDelta)

	parentID := *session.CurrentNodeID
	choiceText := choice
	node := &model.StoryNode{
		StoryID:          session.StoryID,
		SessionID:        session.ID,
		ParentID:         &parentID,
		Depth:            len(pathNodes), // 根 depth=0，路径长度即新节点深度
		ChoiceText:       &choiceText,
		Content:          result.Content,
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

// mergeState 应用属性增量：数值累加，非数值覆盖（集合式延后）。
func mergeState(current, delta map[string]any) map[string]any {
	out := make(map[string]any, len(current))
	for k, v := range current {
		out[k] = v
	}
	for k, dv := range delta {
		if cur, ok := out[k]; ok {
			if cf, okc := toFloat(cur); okc {
				if df, okd := toFloat(dv); okd {
					out[k] = cf + df // 数值累加
					continue
				}
			}
		}
		out[k] = dv // 标量覆盖 / 新键
	}
	return out
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
