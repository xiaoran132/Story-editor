package service

import (
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"backend/internal/model"
	"backend/pkg"

	"github.com/google/uuid"
)

// wantNotFound 断言 err 是 404 的 AppError（越权不泄露存在性）。
func wantNotFound(t *testing.T, err error, ctx string) {
	t.Helper()
	var appErr *pkg.AppError
	if !errors.As(err, &appErr) || appErr.StatusCode != http.StatusNotFound {
		t.Fatalf("%s: 期望 404 AppError，实得 %v", ctx, err)
	}
}

// TestCanViewStory 覆盖草稿访问边界：作者可读自己的任何状态，其他人只读 published。
func TestCanViewStory(t *testing.T) {
	author := uuid.New()
	other := uuid.New()

	draft := &model.Story{CreatorID: author, Status: statusDraft}
	published := &model.Story{CreatorID: author, Status: statusPublished}

	cases := []struct {
		name    string
		story   *model.Story
		viewer  uuid.UUID
		wantErr bool
	}{
		{"草稿 + 作者", draft, author, false},
		{"草稿 + 其他登录用户", draft, other, true},
		{"草稿 + 未登录", draft, uuid.Nil, true},
		{"已发布 + 作者", published, author, false},
		{"已发布 + 其他登录用户", published, other, false},
		{"已发布 + 未登录", published, uuid.Nil, false},
		{"作品不存在", nil, other, true},
	}

	for _, c := range cases {
		err := canViewStory(c.story, c.viewer)
		if c.wantErr {
			wantNotFound(t, err, c.name)
		} else if err != nil {
			t.Fatalf("%s: 期望放行，实得 %v", c.name, err)
		}
	}

	// 匿名作品（CreatorID 为 Nil，理论上不该存在）不得因 viewer 也是 Nil 而被当成作者。
	orphan := &model.Story{CreatorID: uuid.Nil, Status: statusDraft}
	wantNotFound(t, canViewStory(orphan, uuid.Nil), "无主草稿 + 未登录")
}

// TestCanPlay 与 canViewStory 同规则；单列一遍是为了锁死「取消发布后非作者立刻玩不了」。
func TestCanPlay(t *testing.T) {
	author := uuid.New()
	other := uuid.New()

	s := &model.Story{CreatorID: author, Status: statusPublished}
	if err := canPlay(s, other); err != nil {
		t.Fatalf("已发布作品应可玩，实得 %v", err)
	}

	s.Status = statusDraft // 作者取消发布
	wantNotFound(t, canPlay(s, other), "取消发布后 + 非作者")
	if err := canPlay(s, author); err != nil {
		t.Fatalf("作者应能试玩自己的草稿，实得 %v", err)
	}
	wantNotFound(t, canPlay(s, uuid.Nil), "草稿 + 未登录")
}

const worldWithSecrets = `{
  "background": "b",
  "theme": "starmap",
  "initial_state": {"hp": 100, "suspicion": 0, "truth": "unknown"},
  "attributes": {
    "hp":        {"type": "number", "initial": 100, "max": 100},
    "suspicion": {"type": "number", "initial": 0, "hidden": true},
    "truth":     {"type": "scalar", "initial": "unknown", "reveal": true}
  }
}`

// TestSanitizeWorldConfig 锁死脱敏契约：hidden 整条消失，reveal 留声明去初值，
// 且两处存放初值的地方（attributes[k].initial 与 initial_state[k]）都要清干净。
func TestSanitizeWorldConfig(t *testing.T) {
	var w map[string]any
	if err := json.Unmarshal([]byte(sanitizeWorldConfig(worldWithSecrets)), &w); err != nil {
		t.Fatalf("脱敏结果不是合法 JSON: %v", err)
	}
	attrs := w["attributes"].(map[string]any)
	initial := w["initial_state"].(map[string]any)

	if _, ok := attrs["suspicion"]; ok {
		t.Error("hidden 属性的声明应被整条移除")
	}
	if _, ok := initial["suspicion"]; ok {
		t.Error("hidden 属性的初值应从 initial_state 移除")
	}

	truth, ok := attrs["truth"].(map[string]any)
	if !ok {
		t.Fatal("reveal 属性应保留声明（前端要据 type 画锁定占位）")
	}
	if _, ok := truth["initial"]; ok {
		t.Error("未揭示的 reveal 属性不应带 initial")
	}
	if truth["type"] != "scalar" {
		t.Error("reveal 属性的 type 应保留")
	}
	if _, ok := initial["truth"]; ok {
		t.Error("未揭示的 reveal 属性初值应从 initial_state 移除")
	}

	hp, ok := attrs["hp"].(map[string]any)
	if !ok || hp["initial"] != float64(100) || hp["max"] != float64(100) {
		t.Error("普通属性应原样保留（含 max）")
	}
	if initial["hp"] != float64(100) {
		t.Error("普通属性的 initial_state 应原样保留")
	}
	if w["theme"] != "starmap" || w["background"] != "b" {
		t.Error("未知键/无关键应原样透传")
	}
}

// TestSanitizeWorldConfigTolerant 脱敏不得把作品变得打不开：脏数据一律原样返回。
func TestSanitizeWorldConfigTolerant(t *testing.T) {
	for _, raw := range []string{"", "{}", "not json", `{"attributes": "wrong type"}`} {
		if got := sanitizeWorldConfig(raw); got != raw {
			t.Errorf("输入 %q 应原样返回，实得 %q", raw, got)
		}
	}
}

// TestStoryViewFor 校验分流：作者拿完整配置，其他人拿脱敏版。
func TestStoryViewFor(t *testing.T) {
	author := uuid.New()
	s := &model.Story{CreatorID: author, Status: statusPublished, WorldConfig: worldWithSecrets}

	if got := storyViewFor(s, author).WorldConfig; got != worldWithSecrets {
		t.Error("作者应拿到未经改动的 world_config（编辑器要用）")
	}
	for _, viewer := range []uuid.UUID{uuid.New(), uuid.Nil} {
		if got := storyViewFor(s, viewer).WorldConfig; got == worldWithSecrets {
			t.Errorf("非作者（%v）应拿到脱敏版", viewer)
		}
	}
}
