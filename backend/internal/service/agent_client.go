package service

import (
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
}

// NewAgentClient 以 agent 服务地址（cfg.AgentURL，默认 http://localhost:8001）构造。
func NewAgentClient(serviceURL string) *AgentClient {
	return &AgentClient{
		baseURL: strings.TrimRight(serviceURL, "/"),
		httpClient: &http.Client{
			Timeout: 90 * time.Second,
		},
	}
}

// ----- 对外的输入/输出类型 -----

// WorldConfig 是作品世界观配置的解析结果（对应 stories.world_config JSONB）。
type WorldConfig struct {
	Background   string         `json:"background"`
	Style        string         `json:"style"`
	Rules        string         `json:"rules"`
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

// post 向 AI 服务发送 JSON 请求并解析 AIResult。
func (c *AgentClient) post(ctx context.Context, path string, payload any) (*AIResult, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("call ai service: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ai service status %d: %s", resp.StatusCode, string(body))
	}

	var result AIResult
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("decode ai result: %w (raw: %s)", err, string(body))
	}
	if result.Options == nil {
		result.Options = []Option{}
	}
	if result.StateDelta == nil {
		result.StateDelta = map[string]any{}
	}
	return &result, nil
}
