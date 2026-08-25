package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"backend/internal/model"
	"backend/internal/service"
	"backend/pkg"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const assistTestEncryptionKey = "assist-handler-test-key"

type assistTestStore struct {
	platform map[string]*model.PlatformLLMSetting
	conns    map[uuid.UUID]*model.LLMConnection
	assist   map[uuid.UUID]*model.UserAssistLLMConfig
	credit   map[uuid.UUID]int64
	charges  []*model.LLMUsageLog
}

func (s *assistTestStore) FindConnByID(_ context.Context, id uuid.UUID) (*model.LLMConnection, error) {
	return s.conns[id], nil
}

func (s *assistTestStore) FindPlatform(_ context.Context, stage string) (*model.PlatformLLMSetting, error) {
	return s.platform[stage], nil
}

func (s *assistTestStore) FindStoryConfig(_ context.Context, _, _ uuid.UUID) (*model.UserStoryLLMConfig, error) {
	return nil, nil
}

func (s *assistTestStore) FindAssistConfig(_ context.Context, userID uuid.UUID) (*model.UserAssistLLMConfig, error) {
	return s.assist[userID], nil
}

func (s *assistTestStore) GetCredit(_ context.Context, userID uuid.UUID) (int64, error) {
	return s.credit[userID], nil
}

func (s *assistTestStore) ChargeCredit(_ context.Context, usage *model.LLMUsageLog) error {
	s.charges = append(s.charges, usage)
	return nil
}

func assistCipher(t *testing.T, key string) string {
	t.Helper()
	cipher, err := pkg.Encrypt(key, assistTestEncryptionKey)
	if err != nil {
		t.Fatalf("encrypt test key: %v", err)
	}
	return cipher
}

func newAssistTestHandler(t *testing.T, store *assistTestStore, received *[]map[string]any) (*AssistHandler, func()) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode agent request: %v", err)
		}
		*received = append(*received, body)

		response := map[string]any{"usage": map[string]any{"prompt_tokens": 11, "completion_tokens": 7}}
		switch r.URL.Path {
		case "/assist/world":
			response["background"] = "b"
			response["style"] = "s"
			response["rules"] = "r"
			response["outline"] = "o"
			response["characters"] = []any{}
			response["initial_state"] = map[string]any{}
			response["attributes"] = map[string]any{}
		case "/assist/opening":
			response["content"] = "opening"
			response["options"] = []any{}
		case "/assist/polish":
			response["text"] = "source"
			response["applied"] = false
			response["feedback"] = []any{}
		case "/assist/branches":
			response["branches"] = []any{}
		default:
			t.Fatalf("unexpected agent path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(response); err != nil {
			t.Fatalf("write agent response: %v", err)
		}
	}))
	resolver := service.NewLLMResolver(store, assistTestEncryptionKey)
	return NewAssistHandler(service.NewAgentClient(server.URL), resolver, service.NewCreditService(store)), server.Close
}

func callAssist(t *testing.T, h *AssistHandler, userID uuid.UUID, body string, action func(*gin.Context)) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/v1/assist", bytes.NewBufferString(body))
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Set("user_id", userID)
	action(ctx)
	return recorder
}

func TestAssistHandlersForwardPlatformModelAndChargeKnownUsage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	userID := uuid.New()
	store := &assistTestStore{
		platform: map[string]*model.PlatformLLMSetting{
			service.StageWorld: {
				Stage: service.StageWorld, Provider: "test", BaseURL: "https://platform.example", Model: "platform-world",
				APIKeyCipher: assistCipher(t, "platform-key"), PriceInPerMTok: 1, PriceOutPerMTok: 1,
			},
		},
		conns:  map[uuid.UUID]*model.LLMConnection{},
		credit: map[uuid.UUID]int64{userID: service.MicroPerCNY},
	}
	var received []map[string]any
	h, closeServer := newAssistTestHandler(t, store, &received)
	defer closeServer()

	calls := []struct {
		body   string
		action func(*gin.Context)
		stage  string
	}{
		{`{"idea":"idea","llm":{"model":"client-injected"}}`, h.World, service.StageAssistWorld},
		{`{"world":{}}`, h.Opening, service.StageAssistOpening},
		{`{"text":"source","world":{"style":"plain","style_profile":{"rhythm":"tight"}},"llm":{"model":"client-injected"}}`, h.Polish, service.StageAssistPolish},
		{`{"content":"source","world":{}}`, h.Branches, service.StageAssistBranches},
	}
	for _, tc := range calls {
		response := callAssist(t, h, userID, tc.body, tc.action)
		if response.Code != http.StatusOK {
			t.Fatalf("%s status = %d, body=%s", tc.stage, response.Code, response.Body.String())
		}
	}

	if len(received) != len(calls) {
		t.Fatalf("agent request count = %d, want %d", len(received), len(calls))
	}
	for i, request := range received {
		llmKey := "llm"
		if calls[i].stage == service.StageAssistOpening {
			llmKey = "llm_write"
			if _, hasReview := request["llm_review"]; hasReview {
				t.Fatal("assist opening must not enable player hard review")
			}
		}
		llm, ok := request[llmKey].(map[string]any)
		if !ok || llm["model"] != "platform-world" {
			t.Fatalf("%s did not receive server-resolved model: %#v", calls[i].stage, request[llmKey])
		}
	}
	polishWorld := received[2]["world"].(map[string]any)
	profile := polishWorld["style_profile"].(map[string]any)
	if profile["rhythm"] != "tight" {
		t.Fatalf("style_profile was not forwarded: %#v", profile)
	}

	if len(store.charges) != len(calls) {
		t.Fatalf("charge count = %d, want %d", len(store.charges), len(calls))
	}
	for i, charge := range store.charges {
		if charge.Stage != calls[i].stage || charge.StoryID != nil {
			t.Fatalf("charge %d = %+v, want stage=%s and nil StoryID", i, charge, calls[i].stage)
		}
		if charge.PromptTokens != 11 || charge.CompletionTokens != 7 {
			t.Fatalf("charge %d usage = %+v", i, charge)
		}
	}
}

func TestAssistPolishByokSkipsPlatformUsage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	userID, connectionID := uuid.New(), uuid.New()
	store := &assistTestStore{
		platform: map[string]*model.PlatformLLMSetting{},
		conns: map[uuid.UUID]*model.LLMConnection{
			connectionID: {
				ID: connectionID, UserID: userID, Provider: "test", BaseURL: "https://byok.example", Models: `["byok-model"]`,
				APIKeyCipher: assistCipher(t, "byok-key"),
			},
		},
		// 创作辅助用哪条连接的哪个模型是**账号级设置**，不由请求体携带。
		assist: map[uuid.UUID]*model.UserAssistLLMConfig{
			userID: {UserID: userID, ConnID: &connectionID, Model: "byok-model"},
		},
		credit: map[uuid.UUID]int64{userID: service.MicroPerCNY},
	}
	var received []map[string]any
	h, closeServer := newAssistTestHandler(t, store, &received)
	defer closeServer()

	response := callAssist(t, h, userID, `{"text":"source","world":{}}`, h.Polish)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", response.Code, response.Body.String())
	}
	if len(store.charges) != 0 {
		t.Fatalf("BYOK must not create platform usage logs: %+v", store.charges)
	}
	if got := received[0]["llm"].(map[string]any)["model"]; got != "byok-model" {
		t.Fatalf("BYOK model = %v, want byok-model", got)
	}
}
