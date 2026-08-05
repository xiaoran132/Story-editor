package service

import (
	"context"
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

func cipherOf(t *testing.T, plain string) string {
	t.Helper()
	c, err := pkg.Encrypt(plain, testEncKey)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	return c
}

// TestResolveForPlay 覆盖作品级优先级：作品配置 > 平台 > nil，及模型回退/连接失效。
func TestResolveForPlay(t *testing.T) {
	uid := uuid.New()
	sid := uuid.New()
	connA := uuid.New()

	f := &fakeLLM{
		conns: map[uuid.UUID]*model.LLMConnection{
			connA: {ID: connA, UserID: uid, Provider: "deepseek", BaseURL: "https://u", DefaultModel: "model-default", APIKeyCipher: cipherOf(t, "user-key")},
		},
		platform: map[string]*model.PlatformLLMSetting{
			StageReview: {Stage: StageReview, Provider: "plat", BaseURL: "https://p", Model: "plat-model", APIKeyCipher: cipherOf(t, "plat-key")},
		},
		story: map[string]*model.UserStoryLLMConfig{
			// write 绑定 connA 且指定模型 model-A；review 不配（回退平台）
			uid.String() + "|" + sid.String(): {UserID: uid, StoryID: sid,
				Bindings: `{"write":{"conn":"` + connA.String() + `","model":"model-A"}}`},
		},
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

// TestResolveForPlayModelFallback 校验作品配置未指定 model 时回退连接 DefaultModel。
func TestResolveForPlayModelFallback(t *testing.T) {
	uid, sid, connA := uuid.New(), uuid.New(), uuid.New()
	f := &fakeLLM{
		conns: map[uuid.UUID]*model.LLMConnection{
			connA: {ID: connA, UserID: uid, DefaultModel: "conn-default", APIKeyCipher: cipherOf(t, "k")},
		},
		platform: map[string]*model.PlatformLLMSetting{},
		story: map[string]*model.UserStoryLLMConfig{
			uid.String() + "|" + sid.String(): {Bindings: `{"write":{"conn":"` + connA.String() + `"}}`},
		},
	}
	r := NewLLMResolver(f, testEncKey)
	if cfg, _ := r.ResolveForPlay(context.Background(), uid, sid, StageWrite); cfg == nil || cfg.Model != "conn-default" {
		t.Fatalf("未指定 model 应回退连接 DefaultModel: %+v", cfg)
	}
}

// TestResolveForAssist 覆盖创作侧：编辑器覆盖连接 > 平台 world > nil。
func TestResolveForAssist(t *testing.T) {
	uid, connO := uuid.New(), uuid.New()
	f := &fakeLLM{
		conns: map[uuid.UUID]*model.LLMConnection{
			connO: {ID: connO, UserID: uid, Provider: "openai", BaseURL: "https://o", DefaultModel: "gpt-x", APIKeyCipher: cipherOf(t, "ovr-key")},
		},
		platform: map[string]*model.PlatformLLMSetting{
			StageWorld: {Stage: StageWorld, BaseURL: "https://p", Model: "plat-world", APIKeyCipher: cipherOf(t, "plat-key")},
		},
		story: map[string]*model.UserStoryLLMConfig{},
	}
	r := NewLLMResolver(f, testEncKey)
	ctx := context.Background()

	// 1) 编辑器覆盖连接优先
	if cfg, _ := r.ResolveForAssist(ctx, uid, &connO); cfg == nil || cfg.APIKey != "ovr-key" || cfg.Model != "gpt-x" {
		t.Fatalf("override 未生效: %+v", cfg)
	}
	// 2) 无覆盖 → 回退平台 world
	if cfg, _ := r.ResolveForAssist(ctx, uid, nil); cfg == nil || cfg.APIKey != "plat-key" || cfg.Model != "plat-world" {
		t.Fatalf("应回退平台 world: %+v", cfg)
	}
}
