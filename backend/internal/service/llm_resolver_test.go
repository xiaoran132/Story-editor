package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"backend/internal/model"
	"backend/pkg"

	"github.com/google/uuid"
)

const testEncKey = "test-encryption-key"

// fakeLLM 实现 llmStore：按 id 存连接、按 stage 存平台设置、按 (user,story) 存作品配置。
type fakeLLM struct {
	conns    map[uuid.UUID]*model.LLMConnection
	platform map[string]*model.PlatformLLMSetting
	story    map[string]*model.UserStoryLLMConfig // key: userID+"|"+storyID
	assist   map[uuid.UUID]*model.UserAssistLLMConfig
	credit   map[uuid.UUID]int64 // 平台额度余额（微元）；缺省 = 0 = 没额度
}

func (f *fakeLLM) FindAssistConfig(_ context.Context, userID uuid.UUID) (*model.UserAssistLLMConfig, error) {
	return f.assist[userID], nil
}

func (f *fakeLLM) FindConnByID(_ context.Context, id uuid.UUID) (*model.LLMConnection, error) {
	return f.conns[id], nil
}
func (f *fakeLLM) FindPlatform(_ context.Context, stage string) (*model.PlatformLLMSetting, error) {
	return f.platform[stage], nil
}
func (f *fakeLLM) FindStoryConfig(_ context.Context, userID, storyID uuid.UUID) (*model.UserStoryLLMConfig, error) {
	return f.story[userID.String()+"|"+storyID.String()], nil
}

func (f *fakeLLM) GetCredit(_ context.Context, userID uuid.UUID) (int64, error) {
	return f.credit[userID], nil
}

func cipherOf(t *testing.T, plain string) string {
	t.Helper()
	c, err := pkg.Encrypt(plain, testEncKey)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	return c
}

// TestResolveForPlay 覆盖作品级优先级：作品配置 > 平台 > nil，及连接失效。
func TestResolveForPlay(t *testing.T) {
	uid := uuid.New()
	sid := uuid.New()
	connA := uuid.New()

	f := &fakeLLM{
		conns: map[uuid.UUID]*model.LLMConnection{
			connA: {ID: connA, UserID: uid, Provider: "deepseek", BaseURL: "https://u", Models: `["model-A"]`, APIKeyCipher: cipherOf(t, "user-key")},
		},
		platform: map[string]*model.PlatformLLMSetting{
			StageReview: {Stage: StageReview, Provider: "plat", BaseURL: "https://p", Model: "plat-model", APIKeyCipher: cipherOf(t, "plat-key")},
		},
		story: map[string]*model.UserStoryLLMConfig{
			// write 绑定 connA 且指定模型 model-A；review 不配（回退平台）
			uid.String() + "|" + sid.String(): {UserID: uid, StoryID: sid,
				Bindings: `{"write":{"conn":"` + connA.String() + `","model":"model-A"}}`},
		},
		// 平台档现在是「有额度才给」，所以想测回退必须先有余额（注册赠 1 元）。
		credit: map[uuid.UUID]int64{uid: MicroPerCNY},
	}
	r := NewLLMResolver(f, testEncKey)
	ctx := context.Background()

	// 1) 作品配置命中 + 环节级模型覆盖
	if cfg, _ := r.ResolveForPlay(ctx, uid, sid, StageWrite); cfg == nil || cfg.APIKey != "user-key" || cfg.Model != "model-A" || cfg.BaseURL != "https://u" {
		t.Fatalf("write 作品配置解析错误: %+v", cfg)
	}
	// 2) 作品未配 review → 回退平台
	if cfg, _ := r.ResolveForPlay(ctx, uid, sid, StageReview); cfg == nil || cfg.APIKey != "plat-key" || cfg.Model != "plat-model" {
		t.Fatalf("review 应回退平台: %+v", cfg)
	}
	// 来源标记决定要不要扣额度——标错了就是白送或错扣，必须锁住。
	if cfg, _ := r.ResolveForPlay(ctx, uid, sid, StageReview); cfg.Source != SourcePlatform {
		t.Fatalf("平台档 Source 应为 platform, 得 %q", cfg.Source)
	}
	if cfg, _ := r.ResolveForPlay(ctx, uid, sid, StageWrite); cfg.Source != SourceUser {
		t.Fatalf("自带连接 Source 应为 user, 得 %q", cfg.Source)
	}
	// 3) 连接被删（作品配置指向不存在连接）+ 平台无 write → nil
	delete(f.conns, connA)
	if cfg, _ := r.ResolveForPlay(ctx, uid, sid, StageWrite); cfg != nil {
		t.Fatalf("连接失效且平台无 write 时应 nil, 得 %+v", cfg)
	}
	// 4) 匿名玩家 + 无平台 → nil
	if cfg, _ := r.ResolveForPlay(ctx, uuid.Nil, sid, StageWrite); cfg != nil {
		t.Fatalf("匿名无平台应 nil, 得 %+v", cfg)
	}
}

// TestResolveForPlayNeedsExplicitModel 锁住「没有默认模型」这条：连接不再持有
// default_model，绑定里 model 为空就是解析不出东西，必须回落下一档而不是硬猜一个。
func TestResolveForPlayNeedsExplicitModel(t *testing.T) {
	uid, sid, connA := uuid.New(), uuid.New(), uuid.New()
	newFake := func() *fakeLLM {
		return &fakeLLM{
			conns: map[uuid.UUID]*model.LLMConnection{
				connA: {ID: connA, UserID: uid, BaseURL: "https://u", Models: `["m1","m2"]`, APIKeyCipher: cipherOf(t, "k")},
			},
			platform: map[string]*model.PlatformLLMSetting{},
			story: map[string]*model.UserStoryLLMConfig{
				uid.String() + "|" + sid.String(): {Bindings: `{"write":{"conn":"` + connA.String() + `"}}`},
			},
			credit: map[uuid.UUID]int64{uid: MicroPerCNY},
		}
	}
	ctx := context.Background()

	// 1) 平台也没配 → 整条链路 nil（调用方据此明确报错）。
	//    绝不能因为连接的 models 里有 m1 就拿它顶上——那就是把默认模型换个地方复活。
	if cfg, _ := NewLLMResolver(newFake(), testEncKey).ResolveForPlay(ctx, uid, sid, StageWrite); cfg != nil {
		t.Fatalf("绑定缺 model 时不得擅自取用连接的任一模型: %+v", cfg)
	}
	// 2) 平台配了 → 回落平台档，而不是停在这条残缺的绑定上。
	f := newFake()
	f.platform[StageWrite] = &model.PlatformLLMSetting{Stage: StageWrite, BaseURL: "https://p", Model: "plat-model", APIKeyCipher: cipherOf(t, "plat-key")}
	if cfg, _ := NewLLMResolver(f, testEncKey).ResolveForPlay(ctx, uid, sid, StageWrite); cfg == nil || cfg.Model != "plat-model" {
		t.Fatalf("绑定缺 model 应回落平台档: %+v", cfg)
	}
}

// TestResolveForAssist 覆盖创作侧：账号级创作辅助配置 > 平台 world > nil。
// 配置来自设置页（user_assist_llm_configs），不由请求体携带。
func TestResolveForAssist(t *testing.T) {
	uid, connO := uuid.New(), uuid.New()
	newFake := func(assist *model.UserAssistLLMConfig) *fakeLLM {
		f := &fakeLLM{
			conns: map[uuid.UUID]*model.LLMConnection{
				connO: {ID: connO, UserID: uid, Provider: "openai", BaseURL: "https://o", Models: `["gpt-x"]`, APIKeyCipher: cipherOf(t, "ovr-key")},
			},
			platform: map[string]*model.PlatformLLMSetting{
				StageWorld: {Stage: StageWorld, BaseURL: "https://p", Model: "plat-world", APIKeyCipher: cipherOf(t, "plat-key")},
			},
			story:  map[string]*model.UserStoryLLMConfig{},
			assist: map[uuid.UUID]*model.UserAssistLLMConfig{},
			credit: map[uuid.UUID]int64{uid: MicroPerCNY},
		}
		if assist != nil {
			f.assist[uid] = assist
		}
		return f
	}
	ctx := context.Background()

	// 1) 账号级配置命中，用的是设置页里选中的那个模型
	f := newFake(&model.UserAssistLLMConfig{UserID: uid, ConnID: &connO, Model: "gpt-x"})
	if cfg, _ := NewLLMResolver(f, testEncKey).ResolveForAssist(ctx, uid); cfg == nil || cfg.APIKey != "ovr-key" || cfg.Model != "gpt-x" {
		t.Fatalf("账号级配置未生效: %+v", cfg)
	}
	// 2) 配了连接却没模型（脏数据）→ 这条作废，回落平台 world，不擅自取连接里的某个模型
	f = newFake(&model.UserAssistLLMConfig{UserID: uid, ConnID: &connO})
	if cfg, _ := NewLLMResolver(f, testEncKey).ResolveForAssist(ctx, uid); cfg == nil || cfg.APIKey != "plat-key" {
		t.Fatalf("缺 model 应回落平台: %+v", cfg)
	}
	// 3) 没配过 → 回退平台 world
	if cfg, _ := NewLLMResolver(newFake(nil), testEncKey).ResolveForAssist(ctx, uid); cfg == nil || cfg.Model != "plat-world" {
		t.Fatalf("应回退平台 world: %+v", cfg)
	}
	// 4) 匿名 → nil（额度挂账号）
	if cfg, _ := NewLLMResolver(newFake(nil), testEncKey).ResolveForAssist(ctx, uuid.Nil); cfg != nil {
		t.Fatalf("匿名不该拿到平台档: %+v", cfg)
	}
}

// TestPlatformNeedsCredit 锁住这次改动的核心：平台档**不是无条件兜底**。
//
// 曾经的链路是「作品配置 → 平台 → agent 的 .env 默认 key」，最后那一档是看不见、
// 无法限额的服务器成本，已删除；平台档本身也从"无条件"改为"要有额度"。
// 没有这个测试，将来有人顺手把无条件回退加回去不会被任何东西拦住。
func TestPlatformNeedsCredit(t *testing.T) {
	uid, sid := uuid.New(), uuid.New()
	newFake := func(credit int64) *fakeLLM {
		return &fakeLLM{
			conns: map[uuid.UUID]*model.LLMConnection{},
			platform: map[string]*model.PlatformLLMSetting{
				StageWrite: {Stage: StageWrite, BaseURL: "https://p", Model: "m", APIKeyCipher: cipherOf(t, "plat-key")},
			},
			story:  map[string]*model.UserStoryLLMConfig{},
			credit: map[uuid.UUID]int64{uid: credit},
		}
	}
	ctx := context.Background()

	// 有额度 → 给平台档
	r := NewLLMResolver(newFake(MicroPerCNY), testEncKey)
	if cfg, _ := r.ResolveForPlay(ctx, uid, sid, StageWrite); cfg == nil || cfg.APIKey != "plat-key" {
		t.Fatalf("有额度时应给平台档: %+v", cfg)
	}

	// 额度耗尽 → 不给（即便 admin 配了平台 key）
	r = NewLLMResolver(newFake(0), testEncKey)
	if cfg, _ := r.ResolveForPlay(ctx, uid, sid, StageWrite); cfg != nil {
		t.Fatalf("额度为 0 时不应给平台档: %+v", cfg)
	}

	// 匿名 → 不给。额度挂在账号上，而且所有匿名玩家共享同一个 guest id，
	// 给了等于让第一个访客花光所有人的额度。
	r = NewLLMResolver(newFake(MicroPerCNY), testEncKey)
	if cfg, _ := r.ResolveForPlay(ctx, uuid.Nil, sid, StageWrite); cfg != nil {
		t.Fatalf("匿名不应给平台档: %+v", cfg)
	}
}

// TestCostMicro 校验折算与向上取整：几百 token 的调用不能因为四舍五入而免费。
func TestCostMicro(t *testing.T) {
	// 1 元/百万输入 token、2 元/百万输出 token
	got := costMicro(TokenUsage{PromptTokens: 1_000_000, CompletionTokens: 1_000_000}, 1, 2, 0)
	if got != 3*MicroPerCNY {
		t.Fatalf("百万进+百万出应为 3 元 = %d 微元, 得 %d", 3*MicroPerCNY, got)
	}
	// 小额调用必须扣到至少 1 微元，不能归零（否则 1 元额度等于无限）
	if got := costMicro(TokenUsage{PromptTokens: 1, CompletionTokens: 1}, 1, 2, 0); got < 1 {
		t.Fatalf("极小调用也应扣至少 1 微元, 得 %d", got)
	}
	// 零用量不扣
	if got := costMicro(TokenUsage{}, 1, 2, 0); got != 0 {
		t.Fatalf("零用量应不扣, 得 %d", got)
	}
	// 缓存命中的输入按缓存价折算：10 万命中(0.01) + 90 万未命中(0.9) + 百万输出(2) = 2.91 元
	got = costMicro(TokenUsage{PromptTokens: 1_000_000, CompletionTokens: 1_000_000, CacheReadTokens: 100_000}, 1, 2, 0.1)
	if want := int64(2.91 * float64(MicroPerCNY)); got != want {
		t.Fatalf("缓存命中应按 1/10 价折算: 期望 %d 微元, 得 %d", want, got)
	}
	// 缓存价未配置（0）= 按全价，不能变成免费
	full := costMicro(TokenUsage{PromptTokens: 1_000_000}, 1, 2, 0)
	cached := costMicro(TokenUsage{PromptTokens: 1_000_000, CacheReadTokens: 400_000}, 1, 2, 0)
	if cached != full {
		t.Fatalf("未配置缓存价时命中部分必须按全价（多扣是安全方向）: %d vs %d", cached, full)
	}
	// 异常数据（命中数超过总输入数）钳回全价，不得算出负数
	if got := costMicro(TokenUsage{PromptTokens: 100, CacheReadTokens: 500}, 1, 2, 0.1); got != costMicro(TokenUsage{PromptTokens: 100}, 1, 2, 0) {
		t.Fatalf("命中数超总输入应按全价处理, 得 %d", got)
	}
}

// TestPlatformPriceRoundTrip 锁住一个真实踩过的坑：单价加了数据库列和前端输入框，
// 却没接进 PlatformInput / PlatformLLMSettingResponse —— 保存看似成功，值被静默丢弃，
// 返回体里也没有该字段，前端拿回 undefined 覆盖输入框，表现为「存不进去」。
func TestPlatformPriceRoundTrip(t *testing.T) {
	// 入参：JSON 标签必须对得上，且 0 与「未传」要能区分（0 是合法单价）。
	var in PlatformInput
	if err := json.Unmarshal([]byte(`{"price_in_per_mtok":1.5,"price_out_per_mtok":0,"price_cache_in_per_mtok":0.15}`), &in); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if in.PriceInPerMTok == nil || *in.PriceInPerMTok != 1.5 {
		t.Fatalf("price_in 未解出: %+v", in.PriceInPerMTok)
	}
	if in.PriceOutPerMTok == nil || *in.PriceOutPerMTok != 0 {
		t.Fatalf("显式的 0 必须能与「未传」区分，否则 admin 改不回免费: %+v", in.PriceOutPerMTok)
	}
	if in.PriceCacheInPerMTok == nil || *in.PriceCacheInPerMTok != 0.15 {
		t.Fatalf("price_cache_in 未解出: %+v", in.PriceCacheInPerMTok)
	}
	var empty PlatformInput
	if err := json.Unmarshal([]byte(`{}`), &empty); err != nil || empty.PriceInPerMTok != nil {
		t.Fatalf("未传单价时应为 nil（保留原值）")
	}

	// 出参：DTO 必须带回单价，否则前端保存后输入框被 undefined 覆盖。
	s := &LLMService{encKey: testEncKey}
	res := s.toPlatformResponse(&model.PlatformLLMSetting{
		Stage: StageWrite, Model: "m", PriceInPerMTok: 1.5, PriceOutPerMTok: 8, PriceCacheInPerMTok: 0.15,
	})
	if res.PriceInPerMTok != 1.5 || res.PriceOutPerMTok != 8 || res.PriceCacheInPerMTok != 0.15 {
		t.Fatalf("响应 DTO 丢了单价: %+v", res)
	}
	blob, _ := json.Marshal(res)
	if !strings.Contains(string(blob), `"price_in_per_mtok":1.5`) {
		t.Fatalf("序列化后缺少 price_in_per_mtok: %s", blob)
	}
	if !strings.Contains(string(blob), `"price_cache_in_per_mtok":0.15`) {
		t.Fatalf("序列化后缺少 price_cache_in_per_mtok: %s", blob)
	}
}

// TestPlatformOptionFor 守住两件事：平台档的可用性**按环节各算各的**，
// 以及预设模型名在不可用时也要回得来（否则前端只能显示一个空的禁用框）。
func TestPlatformOptionFor(t *testing.T) {
	uid := uuid.New()
	f := &fakeLLM{
		platform: map[string]*model.PlatformLLMSetting{
			// write 配了 key；review 只有行、没 key（admin 只配了一半）
			StageWrite:  {Stage: StageWrite, Model: "write-model", APIKeyCipher: cipherOf(t, "plat-key")},
			StageReview: {Stage: StageReview, Model: "review-model"},
		},
		credit: map[uuid.UUID]int64{uid: 1_000_000},
	}
	r := NewLLMResolver(f, testEncKey)

	if got := r.PlatformOptionFor(context.Background(), uid, StageWrite); !got.Ready || got.Model != "write-model" {
		t.Fatalf("write 档应可用且带模型名: %+v", got)
	}
	// review 没 key → 不可用，但模型名照回：玩家该看见自己错过的是什么。
	got := r.PlatformOptionFor(context.Background(), uid, StageReview)
	if got.Ready {
		t.Fatalf("review 没配 key 却判为可用——可用性不能借用 write 的结论: %+v", got)
	}
	if got.Model != "review-model" {
		t.Fatalf("不可用时也要回预设模型名: %+v", got)
	}
	// 额度耗尽 → 全环节都不可用，模型名仍在。
	f.credit[uid] = 0
	if got := r.PlatformOptionFor(context.Background(), uid, StageWrite); got.Ready || got.Model != "write-model" {
		t.Fatalf("额度耗尽应不可用但保留模型名: %+v", got)
	}
	// 该环节压根没配 → 空壳，不是崩溃。
	if got := r.PlatformOptionFor(context.Background(), uid, StageWorld); got.Ready || got.Model != "" {
		t.Fatalf("未配置的环节应回空壳: %+v", got)
	}
}
