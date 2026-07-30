package service

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// AgentClient 调用独立的 Python agent 服务（FastAPI + LangGraph）。
// 后端只做「组装上下文 → HTTP 调用 → 落库」，剧情生成的提示词与工作流全在 Python 侧，
// 便于后期扩展多模型路由、一致性检查等 Agent 节点而不改动 Go。
type AgentClient struct {
	baseURL    string
	httpClient *http.Client
	// streamClient 无整请求超时：SSE 流生命周期由调用方 ctx 控制，
	// 复用 httpClient 的 90s Timeout 会在流中途截断。
	streamClient *http.Client
}

// NewAgentClient 以 agent 服务地址（cfg.AgentURL，默认 http://localhost:8001）构造。
func NewAgentClient(serviceURL string) *AgentClient {
	return &AgentClient{
		baseURL: strings.TrimRight(serviceURL, "/"),
		httpClient: &http.Client{
			Timeout: 90 * time.Second,
		},
		streamClient: &http.Client{}, // 无 Timeout，靠 ctx 控时
	}
}

// ----- 对外的输入/输出类型 -----

// WorldConfig 是作品世界观配置的解析结果（对应 stories.world_config JSONB）。
type WorldConfig struct {
	Background   string         `json:"background"`
	Style        string         `json:"style"`
	Rules        string         `json:"rules"`
	Outline      string         `json:"outline,omitempty"` // 故事大纲：作为 AI 导演的走向锚点（非线性脚本）
	Characters   []any          `json:"characters,omitempty"`
	InitialState map[string]any `json:"initial_state,omitempty"`
	// Attributes 声明每个属性键的类型：{"hp": {"type": "number"}, "items": {"type": "set"}, ...}
	// 透传给 Python AI 服务指导 state_delta 生成，并驱动 mergeState 的按类型合并。
	// omitempty：nil 时不序列化为 null（pydantic 对非 Optional 字段的 null 会返回 422）。
	Attributes map[string]any `json:"attributes,omitempty"`
}

// AttrTypes 从 Attributes 提取「键 -> 合并类型（number|scalar|set）」，只收录显式声明的合法类型。
func (w WorldConfig) AttrTypes() map[string]string {
	out := map[string]string{}
	for k, spec := range w.Attributes {
		m, ok := spec.(map[string]any)
		if !ok {
			continue
		}
		switch m["type"] {
		case "number", "scalar", "set":
			out[k] = m["type"].(string)
		}
	}
	return out
}

// PathStep 是回溯路径上的一步，用于构建 AI 上下文。
type PathStep struct {
	ChoiceText string `json:"choice_text"`
	Content    string `json:"content"`
	Summary    string `json:"summary,omitempty"` // 截至该节点的滚动前情提要（④），老数据为空时 Python 侧回退滑动窗口
}

// Option 是 AI 推荐的下一步选项。
type Option struct {
	Text string `json:"text"`
	Hint string `json:"hint"`
}

// AIResult 是一次生成的结构化结果（与 Python 服务响应对齐）。
type AIResult struct {
	Content    string         `json:"content"`
	Options    []Option       `json:"options"`
	StateDelta map[string]any `json:"state_delta"`
	Summary    string         `json:"summary"` // ④节点树增量摘要，落库到 StoryNode.Summary
	IsEnding   bool           `json:"is_ending"`
	EndingType string         `json:"ending_type"`
}

// ----- Python AI 服务请求体 -----

type generateRequest struct {
	World        WorldConfig    `json:"world"`
	InitialState map[string]any `json:"initial_state,omitempty"`
}

type continueRequest struct {
	World        WorldConfig    `json:"world"`
	History      []PathStep     `json:"history,omitempty"`
	CurrentState map[string]any `json:"current_state,omitempty"`
	Choice       string         `json:"choice"`
}

type openingCompleteRequest struct {
	World        WorldConfig    `json:"world"`
	InitialState map[string]any `json:"initial_state,omitempty"`
	Content      string         `json:"content"`
}

// MergeCandidate 是新选择的一个合并候选（已有同层子节点），由 Go 侧按 state_delta 相等预筛。
type MergeCandidate struct {
	ChoiceText string `json:"choice_text"`
	Content    string `json:"content"`
}

type mergeCheckRequest struct {
	NewChoice  string           `json:"new_choice"`
	NewContent string           `json:"new_content"`
	Candidates []MergeCandidate `json:"candidates"`
}

type mergeCheckResponse struct {
	MatchedIndex int    `json:"matched_index"`
	Reason       string `json:"reason"`
}

// StartStory 生成开场剧情。
func (c *AgentClient) StartStory(ctx context.Context, world WorldConfig, initialState map[string]any) (*AIResult, error) {
	return c.post(ctx, "/generate", generateRequest{World: world, InitialState: initialState})
}

// Continue 根据历史路径、当前属性和玩家选择生成下一段剧情。
func (c *AgentClient) Continue(ctx context.Context, world WorldConfig, history []PathStep, currentState map[string]any, choice string) (*AIResult, error) {
	return c.post(ctx, "/continue", continueRequest{
		World:        world,
		History:      history,
		CurrentState: currentState,
		Choice:       choice,
	})
}

// CompleteOpening 为已写定的开场正文补生成起始选项 + 前情提要（预设 opening_content 的作品）。
func (c *AgentClient) CompleteOpening(ctx context.Context, world WorldConfig, initialState map[string]any, content string) (*AIResult, error) {
	return c.post(ctx, "/opening/complete", openingCompleteRequest{
		World:        world,
		InitialState: initialState,
		Content:      content,
	})
}

// ContinueStream 流式续写：正文增量经 onDelta 实时回调，审校拒绝时回调 onRevise（前端清空重来），
// 流结束返回完整的结构化结果（供 Go 侧做状态合并/去重/落库）。任一回调可为 nil。
func (c *AgentClient) ContinueStream(
	ctx context.Context,
	world WorldConfig, history []PathStep, currentState map[string]any, choice string,
	onDelta func(string), onRevise func(),
) (*AIResult, error) {
	return c.streamInto(ctx, "/continue/stream", continueRequest{
		World: world, History: history, CurrentState: currentState, Choice: choice,
	}, onDelta, onRevise)
}

// StartStoryStream 流式生成开场（无预设 opening_content 的作品）。语义同 ContinueStream。
func (c *AgentClient) StartStoryStream(
	ctx context.Context, world WorldConfig, initialState map[string]any,
	onDelta func(string), onRevise func(),
) (*AIResult, error) {
	return c.streamInto(ctx, "/generate/stream", generateRequest{
		World: world, InitialState: initialState,
	}, onDelta, onRevise)
}

// streamInto 向 agent 的 SSE 端点发请求，逐帧解析：delta→onDelta、revise→onRevise、
// done→返回完整 AIResult、error→返回错误。ContinueStream/StartStoryStream 共用。
func (c *AgentClient) streamInto(
	ctx context.Context, path string, payload any,
	onDelta func(string), onRevise func(),
) (*AIResult, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")

	resp, err := c.streamClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call ai stream: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("ai stream status %d: %s", resp.StatusCode, string(body))
	}

	reader := bufio.NewReader(resp.Body)
	var event, data string
	var final *AIResult
	var streamErr error

	dispatch := func() {
		switch event {
		case "delta":
			var d struct {
				Text string `json:"text"`
			}
			if json.Unmarshal([]byte(data), &d) == nil && onDelta != nil {
				onDelta(d.Text)
			}
		case "revise":
			if onRevise != nil {
				onRevise()
			}
		case "done":
			var r AIResult
			if e := json.Unmarshal([]byte(data), &r); e != nil {
				streamErr = fmt.Errorf("decode done frame: %w (raw: %s)", e, data)
			} else {
				final = &r
			}
		case "error":
			var er struct {
				Detail string `json:"detail"`
			}
			_ = json.Unmarshal([]byte(data), &er)
			streamErr = fmt.Errorf("ai stream error: %s", er.Detail)
		}
		event, data = "", ""
	}

	for {
		line, readErr := reader.ReadString('\n') // bufio.Reader 无 Scanner 的 64KB 行长限制
		if len(line) > 0 {
			line = strings.TrimRight(line, "\r\n")
			switch {
			case line == "":
				dispatch()
			case strings.HasPrefix(line, "event:"):
				event = strings.TrimSpace(line[len("event:"):])
			case strings.HasPrefix(line, "data:"):
				data = strings.TrimSpace(line[len("data:"):])
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				if event != "" || data != "" { // 末帧无结尾空行时兜底派发
					dispatch()
				}
				break
			}
			return nil, fmt.Errorf("read stream: %w", readErr)
		}
	}

	if streamErr != nil {
		return nil, streamErr
	}
	if final == nil {
		return nil, fmt.Errorf("ai stream ended without done frame")
	}
	if final.Options == nil {
		final.Options = []Option{}
	}
	if final.StateDelta == nil {
		final.StateDelta = map[string]any{}
	}
	return final, nil
}

// CheckMerge 判定新选择是否与某个已有同层候选语义等价（候选已按 state_delta 相等预筛）。
// 返回命中的候选下标；-1 表示不合并、应新建节点。候选为空时不调用 AI，直接返回 -1。
func (c *AgentClient) CheckMerge(ctx context.Context, newChoice, newContent string, candidates []MergeCandidate) (int, error) {
	if len(candidates) == 0 {
		return -1, nil
	}
	var out mergeCheckResponse
	err := c.postInto(ctx, "/merge-check", mergeCheckRequest{
		NewChoice:  newChoice,
		NewContent: newContent,
		Candidates: candidates,
	}, &out)
	if err != nil {
		return -1, err
	}
	if out.MatchedIndex < 0 || out.MatchedIndex >= len(candidates) {
		return -1, nil
	}
	return out.MatchedIndex, nil
}

// post 向 AI 服务发送 JSON 请求并解析 AIResult。
func (c *AgentClient) post(ctx context.Context, path string, payload any) (*AIResult, error) {
	var result AIResult
	if err := c.postInto(ctx, path, payload, &result); err != nil {
		return nil, err
	}
	if result.Options == nil {
		result.Options = []Option{}
	}
	if result.StateDelta == nil {
		result.StateDelta = map[string]any{}
	}
	return &result, nil
}

// postInto 向 AI 服务发送 JSON 请求，并把响应体解码进 out（通用于不同响应结构）。
func (c *AgentClient) postInto(ctx context.Context, path string, payload, out any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("call ai service: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("ai service status %d: %s", resp.StatusCode, string(body))
	}

	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("decode ai result: %w (raw: %s)", err, string(body))
	}
	return nil
}
