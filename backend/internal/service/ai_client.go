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

// AIClient 直连 DeepSeek（OpenAI 兼容）的 /chat/completions 端点。
// MVP 阶段在 Go 内构建 prompt 并解析结构化 JSON 结果；
// 后期上 LangGraph 时可替换实现、把请求指回独立的 Python AI 服务。
type AIClient struct {
	apiKey     string
	baseURL    string
	model      string
	httpClient *http.Client
}

func NewAIClient(apiKey, baseURL, model string) *AIClient {
	return &AIClient{
		apiKey:  apiKey,
		baseURL: strings.TrimRight(baseURL, "/"),
		model:   model,
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

// ----- 对外的输入/输出类型 -----

// WorldConfig 是作品世界观配置的解析结果（对应 stories.world_config JSONB）。
type WorldConfig struct {
	Background   string         `json:"background"`
	Style        string         `json:"style"`
	Rules        string         `json:"rules"`
	Characters   []any          `json:"characters"`
	InitialState map[string]any `json:"initial_state"`
}

// PathStep 是回溯路径上的一步，用于构建 AI 上下文。
type PathStep struct {
	ChoiceText string
	Content    string
}

// Option 是 AI 推荐的下一步选项。
type Option struct {
	Text string `json:"text"`
	Hint string `json:"hint"`
}

// AIResult 是一次生成的结构化结果。
type AIResult struct {
	Content    string         `json:"content"`
	Options    []Option       `json:"options"`
	StateDelta map[string]any `json:"state_delta"`
	IsEnding   bool           `json:"is_ending"`
	EndingType string         `json:"ending_type"`
}

// ----- DeepSeek 请求/响应结构（OpenAI 兼容子集）-----

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model          string            `json:"model"`
	Messages       []chatMessage     `json:"messages"`
	Temperature    float64           `json:"temperature"`
	ResponseFormat map[string]string `json:"response_format"`
}

type chatResponse struct {
	Choices []struct {
		Message chatMessage `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

const systemPrompt = `你是一个互动小说的剧情生成引擎。你必须严格返回 JSON 对象，不要包含任何额外文字或 markdown 代码块。
JSON 结构如下：
{
  "content": "本段剧情正文（第二人称叙述，150-300字）",
  "options": [{"text": "选项文字", "hint": "简短提示，可为空"}],
  "state_delta": {"属性键": 数值增减或新值},
  "is_ending": false,
  "ending_type": ""
}
规则：
- options 提供 2-4 个推荐选项；玩家也可能自由输入，你需自然承接。
- state_delta 只包含本段发生变化的属性；属性键必须来自给定的“当前属性”，不要发明新键。数值属性给增减量（如 -10、+50），非数值属性给新值。
- 剧情到达自然结局时 is_ending 设为 true，ending_type 取 good/bad/neutral/hidden 之一，且 options 可为空数组。
- 保持与世界观、风格和历史剧情的一致性。`

// StartStory 生成开场剧情。
func (c *AIClient) StartStory(ctx context.Context, world WorldConfig, initialState map[string]any) (*AIResult, error) {
	var b strings.Builder
	writeWorld(&b, world)
	fmt.Fprintf(&b, "\n当前属性：%s\n", toJSON(initialState))
	b.WriteString("\n请生成这部作品的开场剧情与初始推荐选项。开场通常不产生属性变化，state_delta 可为空对象 {}。")
	return c.complete(ctx, b.String())
}

// Continue 根据历史路径、当前属性和玩家选择生成下一段剧情。
func (c *AIClient) Continue(ctx context.Context, world WorldConfig, history []PathStep, currentState map[string]any, choice string) (*AIResult, error) {
	var b strings.Builder
	writeWorld(&b, world)
	b.WriteString("\n已发生的剧情（从开局到当前，按顺序）：\n")
	for i, step := range history {
		if step.ChoiceText != "" {
			fmt.Fprintf(&b, "  [玩家选择] %s\n", step.ChoiceText)
		}
		fmt.Fprintf(&b, "  [剧情%d] %s\n", i+1, step.Content)
	}
	fmt.Fprintf(&b, "\n当前属性：%s\n", toJSON(currentState))
	fmt.Fprintf(&b, "\n玩家现在的选择/行动：%s\n", choice)
	b.WriteString("\n请承接以上剧情，生成下一段剧情、新的推荐选项，以及本次选择引起的属性变化。")
	return c.complete(ctx, b.String())
}

// complete 调用 DeepSeek 并解析结构化结果。
func (c *AIClient) complete(ctx context.Context, userPrompt string) (*AIResult, error) {
	reqBody := chatRequest{
		Model: c.model,
		Messages: []chatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
		Temperature:    0.8,
		ResponseFormat: map[string]string{"type": "json_object"},
	}
	raw, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("call deepseek: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("deepseek status %d: %s", resp.StatusCode, string(body))
	}

	var cr chatResponse
	if err := json.Unmarshal(body, &cr); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	if cr.Error != nil {
		return nil, fmt.Errorf("deepseek error: %s", cr.Error.Message)
	}
	if len(cr.Choices) == 0 {
		return nil, fmt.Errorf("deepseek returned no choices")
	}

	var result AIResult
	if err := json.Unmarshal([]byte(cr.Choices[0].Message.Content), &result); err != nil {
		return nil, fmt.Errorf("parse ai json content: %w (raw: %s)", err, cr.Choices[0].Message.Content)
	}
	if result.Options == nil {
		result.Options = []Option{}
	}
	if result.StateDelta == nil {
		result.StateDelta = map[string]any{}
	}
	return &result, nil
}

func writeWorld(b *strings.Builder, world WorldConfig) {
	b.WriteString("【世界观设定】\n")
	if world.Background != "" {
		fmt.Fprintf(b, "背景：%s\n", world.Background)
	}
	if world.Style != "" {
		fmt.Fprintf(b, "风格：%s\n", world.Style)
	}
	if world.Rules != "" {
		fmt.Fprintf(b, "规则：%s\n", world.Rules)
	}
	if len(world.Characters) > 0 {
		fmt.Fprintf(b, "角色：%s\n", toJSON(world.Characters))
	}
}

func toJSON(v any) string {
	raw, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(raw)
}
