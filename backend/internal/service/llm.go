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
	Name     string `json:"name"`
	Provider string `json:"provider"`
	BaseURL  string `json:"base_url"`
	APIKey   string `json:"api_key"` // 创建必填；更新时空串=保留原 key
	// Models 是这条连接下可选的模型 id 列表。更新时 nil=保留原值、空数组=非法
	// （一条选不出模型的连接没有用途）。没有「默认模型」，所以这里也没有单数形式。
	Models []string `json:"models"`
}

// ProbeModelsInput 是「存连接之前先拿这套凭据去端点问一遍有哪些模型」的入参。
// 已存连接可只传 connection_id（key 不回显，编辑时用户通常不会重填）。
type ProbeModelsInput struct {
	ConnectionID *uuid.UUID `json:"connection_id,omitempty"`
	BaseURL      string     `json:"base_url"`
	APIKey       string     `json:"api_key"`
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
		Models: parseModels(conn.Models), CreatedAt: conn.CreatedAt,
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
	if strings.TrimSpace(in.Name) == "" || strings.TrimSpace(in.BaseURL) == "" {
		return nil, pkg.BadRequest("name / base_url 均不能为空")
	}
	if strings.TrimSpace(in.APIKey) == "" {
		return nil, pkg.BadRequest("api_key 不能为空")
	}
	models := cleanModels(in.Models)
	if len(models) == 0 {
		return nil, pkg.BadRequest("请至少选择一个模型（可从端点拉取，或手动填写）")
	}
	cipher, err := pkg.Encrypt(strings.TrimSpace(in.APIKey), s.encKey)
	if err != nil {
		return nil, pkg.Internal("failed to encrypt key")
	}
	conn := &model.LLMConnection{
		UserID: userID, Name: in.Name, Provider: in.Provider, BaseURL: strings.TrimSpace(in.BaseURL),
		APIKeyCipher: cipher, Models: dumpModels(models),
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
	if in.Models != nil { // nil=不改；给了就整体替换（空数组是明确的错误，不是"清空"）
		models := cleanModels(in.Models)
		if len(models) == 0 {
			return nil, pkg.BadRequest("请至少选择一个模型（可从端点拉取，或手动填写）")
		}
		conn.Models = dumpModels(models)
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
				// ping 需要一个具体模型，就拿列表里第一个——这是探针的取值，
				// 不是"默认模型"：真正用哪个模型由调用方在绑定里指定。
				if ms := parseModels(conn.Models); len(ms) > 0 {
					model = ms[0]
				}
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
	// PlatformStages 按环节回平台档「可不可选 + 预设哪个模型」（key ∈ write/review）。
	// 按环节分开是必须的：平台设置本来就每环节一行，合成一个布尔值会让 review
	// 借用 write 的可用性；预设模型名也只有回来了，玩家才知道不选连接会用到什么。
	PlatformStages map[string]PlatformOption `json:"platform_stages"`
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
		write, err := s.resolver.ResolveForPlay(ctx, userID, storyID, StageWrite)
		if err != nil {
			return nil, err
		}
		if write != nil {
			out.Ready = true
		}
		out.PlatformStages = map[string]PlatformOption{}
		for stage := range PlayStages {
			out.PlatformStages[stage] = s.resolver.PlatformOptionFor(ctx, userID, stage)
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
		// 选了连接就必须指明模型——连接不再有默认模型可回退，空 model 存进去
		// 等于存了一条解析不出东西的绑定，开玩时才失败。
		//
		// 但**不**校验它是否还在该连接的 models 列表里：那份列表是选择器的辅助，
		// 用户事后取消勾选某个模型，不该让已经保存的绑定连同存档一起失效。
		mdl := strings.TrimSpace(b.Model)
		if mdl == "" {
			return nil, pkg.BadRequest("选了连接就要选一个模型（环节：" + stage + "）")
		}
		clean[stage] = StageBinding{Conn: b.Conn, Model: mdl}
	}
	// 开着审校却**解析不出任何配置** = 配置错误，当场拒绝。
	// 不静默降级成"关掉审校"：那会让玩家以为审校在生效，而它并没有。
	//
	// 判据是「这一环节能不能解析出配置」，不是「有没有绑用户连接」：平台设置每环节
	// 一行、review 那行同样能配 key，解析链也确实会走它。要求必买自己的连接等于
	// 把已经配好的平台预设模型锁死在选项里选不中。
	if in.ReviewEnabled && clean[StageReview].Conn == "" {
		if s.resolver == nil || !s.resolver.PlatformAvailable(ctx, userID, StageReview) {
			return nil, pkg.BadRequest("开启质量审校需要平台档在「审校」环节可用，或为它选择一条自己的连接")
		}
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

// ----- 创作辅助配置（账号级，设置页里配） -----

// AssistConfigResult 是创作辅助配置的外发信封。
// 除了当前选择，还回平台 world 档的可用性与预设模型名——设置页那个下拉要
// 如实标出「不选连接会用到什么」，而不是给个空白的默认项。
type AssistConfigResult struct {
	Conn     string         `json:"conn"`  // 连接 uuid 字符串；空=用平台 world 档
	Model    string         `json:"model"` // Conn 非空时必填
	Platform PlatformOption `json:"platform"`
}

// AssistConfigInput 是保存创作辅助配置的入参。
type AssistConfigInput struct {
	Conn  string `json:"conn"`
	Model string `json:"model"`
}

func (s *LLMService) GetAssistConfig(userID uuid.UUID) (*AssistConfigResult, error) {
	ctx := context.Background()
	ac, err := s.llm.FindAssistConfig(ctx, userID)
	if err != nil {
		return nil, pkg.Internal("database error")
	}
	out := &AssistConfigResult{}
	if ac != nil && ac.ConnID != nil {
		out.Conn = ac.ConnID.String()
		out.Model = ac.Model
	}
	if s.resolver != nil {
		out.Platform = s.resolver.PlatformOptionFor(ctx, userID, StageWorld)
	}
	return out, nil
}

// SetAssistConfig 整体覆盖。校验与作品级绑定同一套：连接须属本人，选了连接就必须给模型。
func (s *LLMService) SetAssistConfig(userID uuid.UUID, in AssistConfigInput) (*AssistConfigResult, error) {
	ctx := context.Background()
	row := &model.UserAssistLLMConfig{UserID: userID}
	if conn := strings.TrimSpace(in.Conn); conn != "" {
		connID, err := uuid.Parse(conn)
		if err != nil {
			return nil, pkg.BadRequest("非法连接 id：" + conn)
		}
		c, err := s.llm.FindConnByID(ctx, connID)
		if err != nil || c == nil || c.UserID != userID {
			return nil, pkg.BadRequest("连接不存在或不属于你：" + conn)
		}
		mdl := strings.TrimSpace(in.Model)
		if mdl == "" {
			return nil, pkg.BadRequest("选了连接就要选一个模型")
		}
		row.ConnID = &connID
		row.Model = mdl
	}
	if err := s.llm.UpsertAssistConfig(ctx, row); err != nil {
		return nil, pkg.Internal("failed to save assist config")
	}
	return s.GetAssistConfig(userID)
}

// ----- 模型列表（拉取连接端点的 /models，供下拉选择） -----

// parseModels / dumpModels 是 LLMConnection.Models（JSON 数组文本）的两端。
// 坏数据回空列表而不是报错：一条连接的模型列表读不出来，最坏后果是前端少了候选项，
// 不该让整个连接列表接口 500。
func parseModels(raw string) []string {
	out := []string{}
	if strings.TrimSpace(raw) == "" {
		return out
	}
	_ = json.Unmarshal([]byte(raw), &out)
	if out == nil {
		out = []string{}
	}
	return out
}

func dumpModels(models []string) string {
	b, err := json.Marshal(models)
	if err != nil {
		return "[]"
	}
	return string(b)
}

// cleanModels 去空白、去空串、去重，并保持用户勾选的顺序。
func cleanModels(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, m := range in {
		m = strings.TrimSpace(m)
		if m == "" || seen[m] {
			continue
		}
		seen[m] = true
		out = append(out, m)
	}
	return out
}

// ProbeModels 用**表单里**的 base_url/api_key（或已存连接的存量 key）问一遍端点有哪些模型。
// 存在的理由：新建连接时还没有 connID，ListModels 那条路走不通，而"填完 key 就能拉"正是这个流程的核心。
func (s *LLMService) ProbeModels(userID uuid.UUID, in *ProbeModelsInput) ([]string, error) {
	ctx := context.Background()
	baseURL, key := strings.TrimSpace(in.BaseURL), strings.TrimSpace(in.APIKey)
	if key == "" && in.ConnectionID != nil {
		conn, err := s.llm.FindConnByID(ctx, *in.ConnectionID)
		if err != nil {
			return nil, pkg.Internal("database error")
		}
		if conn == nil || conn.UserID != userID {
			return nil, pkg.NotFound("connection not found")
		}
		if plain, err := pkg.Decrypt(conn.APIKeyCipher, s.encKey); err == nil {
			key = plain
		}
		if baseURL == "" {
			baseURL = conn.BaseURL
		}
		// 存量 key 解不开（多为 ENCRYPTION_KEY 变更过，同 toConnResponse 里那种
		// has_key=true / key_hint 空的状态）。说清楚是这件事——否则用户会盯着
		// 明明填好了的 base_url 找问题。
		if key == "" {
			return nil, pkg.BadRequest("这条连接的存量 key 解不开（多因 ENCRYPTION_KEY 变更），请重新填写 API Key 后再拉取")
		}
	}
	if key == "" || baseURL == "" {
		return nil, pkg.BadRequest("base_url 与 api_key 都要先填好，才能拉取模型")
	}
	return s.fetchModels(ctx, baseURL, key)
}

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
	return s.fetchModels(ctx, conn.BaseURL, key)
}

// fetchModels 是真正那次 HTTP：GET {base_url}/models，解 OpenAI 兼容形态。
// ListModels（已存连接）与 ProbeModels（表单现填）共用，免得两处各写一份解析。
func (s *LLMService) fetchModels(ctx context.Context, baseURL, key string) ([]string, error) {
	url := strings.TrimRight(baseURL, "/") + "/models"
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

// UndecryptablePlatformStages 回「当前 ENCRYPTION_KEY 解不开哪些环节的平台 key」，供启动自检。
//
// 存在的理由：密钥配错时，解析链会把每一次解密失败都当成"确定的配置问题"静默下落，
// 玩家看到的是"你没有可用的模型"、admin 页看到的是"未开放"，日志里一个字都没有。
// 这条自检把服务端的配置错误在**启动时**就摆出来，而不是等它伪装成用户的配置问题。
// 返回空切片有两种情况——都正常：库里没有平台设置（干净库），或全部解得开。
func (s *LLMService) UndecryptablePlatformStages() []string {
	rows, err := s.llm.ListPlatform(context.Background())
	if err != nil {
		return nil // 查不到就别在启动时喊；DB 出问题自有别的地方报
	}
	var broken []string
	for i := range rows {
		if rows[i].APIKeyCipher == "" {
			continue // 没配 key 是"还没配"，不是解不开
		}
		if plain, err := pkg.Decrypt(rows[i].APIKeyCipher, s.encKey); err != nil || plain == "" {
			broken = append(broken, rows[i].Stage)
		}
	}
	return broken
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
