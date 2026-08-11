package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"backend/internal/model"
	"backend/internal/repository"
	"backend/pkg"

	"github.com/google/uuid"
)

// LLMService 管理用户 LLM 连接（CRUD）、作品级模型配置、模型列表拉取，以及平台设置（admin）。
// key 一律 AES-GCM 加密落库（pkg.Encrypt，encKey 来自 cfg.EncryptionKey），读接口只回打码 hint。
type LLMService struct {
	llm    *repository.LLMRepository
	agent  *AgentClient
	encKey string
	// resolver 复用同一条解析链来回答「这个玩家能不能开玩」，
	// 免得判定逻辑在 service 与 resolver 里各写一份、日后漂移。
	resolver *LLMResolver
}

func NewLLMService(llm *repository.LLMRepository, agent *AgentClient, encKey string, resolver *LLMResolver) *LLMService {
	return &LLMService{llm: llm, agent: agent, encKey: encKey, resolver: resolver}
}

// ----- 输入类型 -----

type ConnectionInput struct {
	Name         string `json:"name"`
	Provider     string `json:"provider"`
	BaseURL      string `json:"base_url"`
	APIKey       string `json:"api_key"` // 创建必填；更新时空串=保留原 key
	DefaultModel string `json:"default_model"`
}

type TestConnectionInput struct {
	ConnectionID *uuid.UUID `json:"connection_id,omitempty"` // 测试已存连接时给；api_key 空则用其存量 key
	BaseURL      string     `json:"base_url"`
	APIKey       string     `json:"api_key"`
	Model        string     `json:"model"`
}

type PlatformInput struct {
	Provider string `json:"provider"`
	BaseURL  string `json:"base_url"`
	APIKey   string `json:"api_key"` // 空串=保留原 key
	Model    string `json:"model"`
	// 单价（元/百万 token）。用指针：0 是合法取值（免费模型），
	// 不能像上面几个字符串那样用「空=不改」，否则 admin 永远改不回 0。
	PriceInPerMTok  *float64 `json:"price_in_per_mtok"`
	PriceOutPerMTok *float64 `json:"price_out_per_mtok"`
}

// ----- 连接 CRUD -----

// toConnResponse 把连接实体转成外发 DTO（解密算 hint，绝不回明文）。
func (s *LLMService) toConnResponse(conn *model.LLMConnection) model.LLMConnectionResponse {
	res := model.LLMConnectionResponse{
		ID: conn.ID, Name: conn.Name, Provider: conn.Provider, BaseURL: conn.BaseURL,
		DefaultModel: conn.DefaultModel, CreatedAt: conn.CreatedAt,
	}
	if plain, err := pkg.Decrypt(conn.APIKeyCipher, s.encKey); err == nil && plain != "" {
		res.HasKey = true
		res.KeyHint = maskKey(plain)
	} else if conn.APIKeyCipher != "" {
		res.HasKey = true // 密文在但解不开（多为 ENCRYPTION_KEY 变更）：标已配置、无 hint
	}
	return res
}

func (s *LLMService) ListConnections(userID uuid.UUID) ([]model.LLMConnectionResponse, error) {
	conns, err := s.llm.ListConnsByUser(context.Background(), userID)
	if err != nil {
		return nil, pkg.Internal("database error")
	}
	out := make([]model.LLMConnectionResponse, 0, len(conns))
	for i := range conns {
		out = append(out, s.toConnResponse(&conns[i]))
	}
	return out, nil
}

func (s *LLMService) CreateConnection(userID uuid.UUID, in *ConnectionInput) (*model.LLMConnectionResponse, error) {
	if strings.TrimSpace(in.Name) == "" || strings.TrimSpace(in.BaseURL) == "" || strings.TrimSpace(in.DefaultModel) == "" {
		return nil, pkg.BadRequest("name / base_url / default_model 均不能为空")
	}
	if strings.TrimSpace(in.APIKey) == "" {
		return nil, pkg.BadRequest("api_key 不能为空")
	}
	cipher, err := pkg.Encrypt(strings.TrimSpace(in.APIKey), s.encKey)
	if err != nil {
		return nil, pkg.Internal("failed to encrypt key")
	}
	conn := &model.LLMConnection{
		UserID: userID, Name: in.Name, Provider: in.Provider, BaseURL: strings.TrimSpace(in.BaseURL),
		APIKeyCipher: cipher, DefaultModel: strings.TrimSpace(in.DefaultModel),
	}
	if err := s.llm.CreateConnection(context.Background(), conn); err != nil {
		return nil, pkg.Internal("failed to create connection")
	}
	res := s.toConnResponse(conn)
	return &res, nil
}

func (s *LLMService) UpdateConnection(userID, id uuid.UUID, in *ConnectionInput) (*model.LLMConnectionResponse, error) {
	ctx := context.Background()
	conn, err := s.llm.FindConnByID(ctx, id)
	if err != nil {
		return nil, pkg.Internal("database error")
	}
	if conn == nil || conn.UserID != userID {
		return nil, pkg.NotFound("connection not found")
	}
	if in.Name != "" {
		conn.Name = in.Name
	}
	if in.Provider != "" {
		conn.Provider = in.Provider
	}
	if strings.TrimSpace(in.BaseURL) != "" {
		conn.BaseURL = strings.TrimSpace(in.BaseURL)
	}
	if strings.TrimSpace(in.DefaultModel) != "" {
		conn.DefaultModel = strings.TrimSpace(in.DefaultModel)
	}
	if strings.TrimSpace(in.APIKey) != "" { // 空串=保留原 key
		cipher, err := pkg.Encrypt(strings.TrimSpace(in.APIKey), s.encKey)
		if err != nil {
			return nil, pkg.Internal("failed to encrypt key")
		}
		conn.APIKeyCipher = cipher
	}
	if err := s.llm.UpdateConnection(ctx, conn); err != nil {
		return nil, pkg.Internal("failed to update connection")
	}
	res := s.toConnResponse(conn)
	return &res, nil
}

func (s *LLMService) DeleteConnection(userID, id uuid.UUID) error {
	if err := s.llm.DeleteConnection(context.Background(), userID, id); err != nil {
		return pkg.Internal("failed to delete connection")
	}
	return nil
}

// TestConnection 用给定（或存量）配置做一次性 ping。api_key 空且给 connection_id 时用其存量 key。
func (s *LLMService) TestConnection(userID uuid.UUID, in *TestConnectionInput) (*ValidateKeyResponse, error) {
	ctx := context.Background()
	baseURL, key, model := strings.TrimSpace(in.BaseURL), strings.TrimSpace(in.APIKey), strings.TrimSpace(in.Model)
	if key == "" && in.ConnectionID != nil {
		conn, err := s.llm.FindConnByID(ctx, *in.ConnectionID)
		if err == nil && conn != nil && conn.UserID == userID {
			if plain, err := pkg.Decrypt(conn.APIKeyCipher, s.encKey); err == nil {
				key = plain
			}
			if baseURL == "" {
				baseURL = conn.BaseURL
			}
			if model == "" {
				model = conn.DefaultModel
			}
		}
	}
	if key == "" {
		return nil, pkg.BadRequest("api_key 不能为空")
	}
	res, err := s.agent.ValidateKey(ctx, ValidateKeyRequest{APIKey: key, BaseURL: baseURL, Model: model})
	if err != nil {
		return nil, pkg.NewBusinessErrorWithMessage(bizCodeAIUnavailableSvc, "AI 服务暂不可用，请稍后重试")
	}
	return res, nil
}

// bizCodeAIUnavailableSvc 与 handler 侧同码（10013），供 service 层复用。
const bizCodeAIUnavailableSvc = 10013

// ----- 作品级模型配置（玩家在某作品各环节选自己的连接+模型） -----

// StoryLLMConfigResult 是作品级配置的外发信封。
//
// 不只回 bindings：作品详情页要在**同一次请求**里知道「这个玩家现在能不能开玩」，
// 否则拦截逻辑得再多一个接口，或者只能等玩家点了开始才报错。
type StoryLLMConfigResult struct {
	Bindings      StageBindings `json:"bindings"`
	ReviewEnabled bool          `json:"review_enabled"`
	Ready         bool          `json:"ready"`             // write 环节可解析 → 能开玩
	Blocked       string        `json:"blocked,omitempty"` // 不能开玩的原因，前端直接展示
	// CreditMicroCNY 是平台额度余额（微元）。注册赠 1 元，见 model.User.CreditMicroCNY。
	CreditMicroCNY int64 `json:"credit_micro_cny"`
	// PlatformReady 表示「平台」这一档现在可不可选（有额度 + admin 配了该环节的 key）。
	PlatformReady bool `json:"platform_ready"`
}

// GetStoryConfig 返回某玩家在某作品的环节配置 + 能否开玩的判定。
func (s *LLMService) GetStoryConfig(userID, storyID uuid.UUID) (*StoryLLMConfigResult, error) {
	ctx := context.Background()
	sc, err := s.llm.FindStoryConfig(ctx, userID, storyID)
	if err != nil {
		return nil, pkg.Internal("database error")
	}

	out := &StoryLLMConfigResult{Bindings: StageBindings{}}
	if sc != nil {
		out.Bindings = parseBindings(sc.Bindings)
		out.ReviewEnabled = sc.ReviewEnabled
	}
	out.CreditMicroCNY, _ = s.llm.GetCredit(ctx, userID)

	// 「能不能开玩」与真实的解析链保持一致：作品级用户连接 → 平台档（需额度）。
	// 这里复用 resolver 而不是自己再判一遍，免得两处逻辑漂移。
	if s.resolver != nil {
		if write, _ := s.resolver.ResolveForPlay(ctx, userID, storyID, StageWrite); write != nil {
			out.Ready = true
		}
		if p := s.resolver.PlatformAvailable(ctx, userID, StageWrite); p {
			out.PlatformReady = true
		}
	}
	if !out.Ready {
		if out.CreditMicroCNY <= 0 {
			out.Blocked = "平台赠送额度已用尽。请在「个人主页 → AI 连接」添加你自己的模型连接后继续。"
		} else {
			out.Blocked = "还没有可用的模型。请为「续写」环节选择一条连接，或在「个人主页 → AI 连接」先添加一条。"
		}
	}
	return out, nil
}

// StoryLLMConfigInput 是保存作品级配置的入参。
type StoryLLMConfigInput struct {
	Bindings      StageBindings `json:"bindings"`
	ReviewEnabled bool          `json:"review_enabled"`
}

// SetStoryConfig 整体覆盖某玩家在某作品的配置：校验环节 ∈ {write,review} + 连接归属本人。
func (s *LLMService) SetStoryConfig(userID, storyID uuid.UUID, in StoryLLMConfigInput) (*StoryLLMConfigResult, error) {
	ctx := context.Background()
	clean := StageBindings{}
	for stage, b := range in.Bindings {
		if !PlayStages[stage] {
			return nil, pkg.BadRequest("非法环节（作品级仅 write/review）：" + stage)
		}
		if strings.TrimSpace(b.Conn) == "" {
			continue // 清除该环节
		}
		connID, err := uuid.Parse(b.Conn)
		if err != nil {
			return nil, pkg.BadRequest("非法连接 id：" + b.Conn)
		}
		conn, err := s.llm.FindConnByID(ctx, connID)
		if err != nil || conn == nil || conn.UserID != userID {
			return nil, pkg.BadRequest("连接不存在或不属于你：" + b.Conn)
		}
		clean[stage] = StageBinding{Conn: b.Conn, Model: strings.TrimSpace(b.Model)}
	}
	// 开着审校却没给它选连接 = 配置错误，当场拒绝。
	// 不静默降级成"关掉审校"：那会让玩家以为审校在生效，而它并没有。
	if in.ReviewEnabled && clean[StageReview].Conn == "" {
		return nil, pkg.BadRequest("开启质量审校需要为「审校」环节选择一条连接，或关闭该开关")
	}

	raw, _ := json.Marshal(clean)
	if err := s.llm.UpsertStoryConfig(ctx, &model.UserStoryLLMConfig{
		UserID: userID, StoryID: storyID, Bindings: string(raw),
		ReviewEnabled: in.ReviewEnabled,
	}); err != nil {
		return nil, pkg.Internal("failed to save story config")
	}
	return s.GetStoryConfig(userID, storyID)
}

// ----- 模型列表（拉取连接端点的 /models，供下拉选择） -----

// ListModels 用某连接的存量 key 调其 {base_url}/models，返回模型 id 列表。
// 端点不实现 /models（或鉴权失败）时返回错误，前端回退手填。
func (s *LLMService) ListModels(userID, connID uuid.UUID) ([]string, error) {
	ctx := context.Background()
	conn, err := s.llm.FindConnByID(ctx, connID)
	if err != nil {
		return nil, pkg.Internal("database error")
	}
	if conn == nil || conn.UserID != userID {
		return nil, pkg.NotFound("connection not found")
	}
	key, err := pkg.Decrypt(conn.APIKeyCipher, s.encKey)
	if err != nil || key == "" {
		return nil, pkg.BadRequest("连接未配置可用 key")
	}
	url := strings.TrimRight(conn.BaseURL, "/") + "/models"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, pkg.Internal("build request")
	}
	req.Header.Set("Authorization", "Bearer "+key)
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil, pkg.NewBusinessErrorWithMessage(bizCodeAIUnavailableSvc, "拉取模型列表失败："+err.Error())
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, pkg.NewBusinessErrorWithMessage(bizCodeAIUnavailableSvc, "该端点未返回模型列表（HTTP "+http.StatusText(resp.StatusCode)+"），可手填")
	}
	// OpenAI 兼容形态：{"data":[{"id":"..."}]}
	var parsed struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, pkg.NewBusinessErrorWithMessage(bizCodeAIUnavailableSvc, "模型列表格式无法解析，可手填")
	}
	ids := make([]string, 0, len(parsed.Data))
	for _, m := range parsed.Data {
		if m.ID != "" {
			ids = append(ids, m.ID)
		}
	}
	return ids, nil
}

// ----- 平台设置（admin） -----

func (s *LLMService) toPlatformResponse(p *model.PlatformLLMSetting) model.PlatformLLMSettingResponse {
	res := model.PlatformLLMSettingResponse{
		Stage: p.Stage, Provider: p.Provider, BaseURL: p.BaseURL, Model: p.Model,
		PriceInPerMTok: p.PriceInPerMTok, PriceOutPerMTok: p.PriceOutPerMTok,
	}
	if plain, err := pkg.Decrypt(p.APIKeyCipher, s.encKey); err == nil && plain != "" {
		res.HasKey = true
		res.KeyHint = maskKey(plain)
	} else if p.APIKeyCipher != "" {
		res.HasKey = true
	}
	return res
}

// ListPlatform 返回三个环节的平台设置（缺的环节以空壳补齐，便于前端渲染完整表单）。
func (s *LLMService) ListPlatform() ([]model.PlatformLLMSettingResponse, error) {
	rows, err := s.llm.ListPlatform(context.Background())
	if err != nil {
		return nil, pkg.Internal("database error")
	}
	byStage := map[string]*model.PlatformLLMSetting{}
	for i := range rows {
		byStage[rows[i].Stage] = &rows[i]
	}
	out := make([]model.PlatformLLMSettingResponse, 0, 3)
	for _, stage := range []string{StageWrite, StageReview, StageWorld} {
		if p, ok := byStage[stage]; ok {
			out = append(out, s.toPlatformResponse(p))
		} else {
			out = append(out, model.PlatformLLMSettingResponse{Stage: stage})
		}
	}
	return out, nil
}

// UpsertPlatform 更新某环节平台设置。api_key 空串=保留原 key。
func (s *LLMService) UpsertPlatform(stage string, in *PlatformInput) (*model.PlatformLLMSettingResponse, error) {
	if !ValidStages[stage] {
		return nil, pkg.BadRequest("非法环节：" + stage)
	}
	ctx := context.Background()
	existing, err := s.llm.FindPlatform(ctx, stage)
	if err != nil {
		return nil, pkg.Internal("database error")
	}
	p := &model.PlatformLLMSetting{Stage: stage}
	if existing != nil {
		p = existing
	}
	if in.Provider != "" {
		p.Provider = in.Provider
	}
	if strings.TrimSpace(in.BaseURL) != "" {
		p.BaseURL = strings.TrimSpace(in.BaseURL)
	}
	if strings.TrimSpace(in.Model) != "" {
		p.Model = strings.TrimSpace(in.Model)
	}
	if in.PriceInPerMTok != nil {
		if *in.PriceInPerMTok < 0 {
			return nil, pkg.BadRequest("单价不能为负")
		}
		p.PriceInPerMTok = *in.PriceInPerMTok
	}
	if in.PriceOutPerMTok != nil {
		if *in.PriceOutPerMTok < 0 {
			return nil, pkg.BadRequest("单价不能为负")
		}
		p.PriceOutPerMTok = *in.PriceOutPerMTok
	}
	if strings.TrimSpace(in.APIKey) != "" { // 空串=保留原 key
		cipher, err := pkg.Encrypt(strings.TrimSpace(in.APIKey), s.encKey)
		if err != nil {
			return nil, pkg.Internal("failed to encrypt key")
		}
		p.APIKeyCipher = cipher
	}
	if err := s.llm.UpsertPlatform(ctx, p); err != nil {
		return nil, pkg.Internal("failed to save platform setting")
	}
	res := s.toPlatformResponse(p)
	return &res, nil
}
