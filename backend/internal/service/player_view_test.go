package service

import (
	"encoding/json"
	"testing"

	"backend/internal/model"

	"github.com/google/uuid"
)

// 声明：hp 普通、suspicion 隐藏、truth 揭示门控。
var viewWorld = parseWorld(`{
  "attributes": {
    "hp":        {"type": "number", "initial": 100},
    "suspicion": {"type": "number", "initial": 0, "hidden": true},
    "truth":     {"type": "scalar", "initial": "unknown", "reveal": true}
  }
}`)

// keysOf 解析一份状态 JSON，返回它实际包含的键（断言用）。
func keysOf(t *testing.T, raw string) map[string]any {
	t.Helper()
	m := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		t.Fatalf("状态 JSON 非法: %v (%q)", err, raw)
	}
	return m
}

// TestAttrViewState 锁死过滤规则：hidden 永远消失，gated 看该时点的揭示集，普通键不动。
func TestAttrViewState(t *testing.T) {
	v := newAttrView(viewWorld, false)
	if v.full {
		t.Fatal("非作者 + 有 hidden/reveal 声明，不应是 full")
	}
	const state = `{"hp":80,"suspicion":37,"truth":"她撒谎了"}`

	// 未揭示
	m := keysOf(t, v.state(state, map[string]bool{}))
	if _, ok := m["suspicion"]; ok {
		t.Error("hidden 属性不应出现")
	}
	if _, ok := m["truth"]; ok {
		t.Error("未揭示的 reveal 属性不应出现")
	}
	if m["hp"] != float64(80) {
		t.Error("普通属性应原样保留")
	}

	// 已揭示 truth
	m = keysOf(t, v.state(state, map[string]bool{"truth": true}))
	if m["truth"] != "她撒谎了" {
		t.Error("已揭示的 reveal 属性应出现")
	}
	if _, ok := m["suspicion"]; ok {
		t.Error("hidden 属性即便出现在揭示集里也不应外发")
	}

	// hidden 不因被误列进揭示集而解禁
	m = keysOf(t, v.state(state, map[string]bool{"suspicion": true, "truth": true}))
	if _, ok := m["suspicion"]; ok {
		t.Error("hidden 优先于 reveal，任何情况下都不外发")
	}
}

// TestAttrViewAuthorSeesAll 作者玩自己的作品不脱敏——hidden 是他自己写的。
func TestAttrViewAuthorSeesAll(t *testing.T) {
	v := newAttrView(viewWorld, true)
	if !v.full {
		t.Fatal("作者应为 full")
	}
	const state = `{"hp":80,"suspicion":37}`
	if got := v.state(state, nil); got != state {
		t.Errorf("作者应拿到原样状态，实得 %q", got)
	}
}

// TestAttrViewNoFlags 作品没声明任何 hidden/reveal 时不做无谓的解析与重排。
func TestAttrViewNoFlags(t *testing.T) {
	plain := parseWorld(`{"attributes":{"hp":{"type":"number"}}}`)
	v := newAttrView(plain, false)
	if !v.full {
		t.Fatal("无 hidden/reveal 声明时应为 full")
	}
	const state = `{"hp":80}`
	if got := v.state(state, nil); got != state {
		t.Errorf("应原样返回，实得 %q", got)
	}
}

// TestAttrViewNode 节点按**自身** revealed_snapshot 过滤：这是「回溯到发现之前会重新隐藏」
// 的实现点，也是时间线不能提前剧透的保证。
func TestAttrViewNode(t *testing.T) {
	v := newAttrView(viewWorld, false)

	before := &model.StoryNode{
		StateDelta:       `{"hp":-20}`,
		StateSnapshot:    `{"hp":80,"suspicion":37,"truth":"unknown"}`,
		RevealedSnapshot: `[]`,
	}
	after := &model.StoryNode{
		StateDelta:       `{"truth":"她撒谎了","suspicion":10}`,
		StateSnapshot:    `{"hp":80,"suspicion":47,"truth":"她撒谎了"}`,
		RevealedSnapshot: `["truth"]`,
	}

	b := v.node(before)
	if m := keysOf(t, b.StateSnapshot); m["truth"] != nil || m["suspicion"] != nil {
		t.Error("发现之前的节点快照不应含 truth / suspicion")
	}
	if m := keysOf(t, b.StateDelta); m["hp"] != float64(-20) {
		t.Error("普通属性的 delta 应保留")
	}

	a := v.node(after)
	if m := keysOf(t, a.StateSnapshot); m["truth"] != "她撒谎了" {
		t.Error("发现之后的节点快照应含 truth")
	}
	if m := keysOf(t, a.StateDelta); m["suspicion"] != nil {
		t.Error("hidden 属性的 delta 在任何节点都不应外发")
	}
	if m := keysOf(t, a.StateDelta); m["truth"] != "她撒谎了" {
		t.Error("揭示当回合的 delta 应含 truth")
	}
}

// TestAttrViewSession 会话按 revealed_attrs 过滤 current_state。
func TestAttrViewSession(t *testing.T) {
	v := newAttrView(viewWorld, false)
	sess := &model.PlaySession{
		CurrentState:  `{"hp":80,"suspicion":37,"truth":"她撒谎了"}`,
		RevealedAttrs: `["truth"]`,
	}
	m := keysOf(t, v.session(sess).CurrentState)
	if m["suspicion"] != nil {
		t.Error("hidden 不应出现在 current_state")
	}
	if m["truth"] != "她撒谎了" {
		t.Error("已揭示的 reveal 应出现在 current_state")
	}
}

// TestParseKeySet 脏数据一律当空集——宁可多挡，不能因为解析失败就放行。
func TestParseKeySet(t *testing.T) {
	if got := parseKeySet(`["a","b"]`); !got["a"] || !got["b"] || len(got) != 2 {
		t.Errorf("正常数组解析失败: %v", got)
	}
	for _, raw := range []string{"", "not json", "{}", `[1,2]`} {
		if got := parseKeySet(raw); len(got) != 0 {
			t.Errorf("输入 %q 应得空集，实得 %v", raw, got)
		}
	}
}

// TestAttrViewTolerant 状态 JSON 非法时原样返回，不能把一局游戏变得打不开。
func TestAttrViewTolerant(t *testing.T) {
	v := newAttrView(viewWorld, false)
	for _, raw := range []string{"", "not json"} {
		if got := v.state(raw, nil); got != raw {
			t.Errorf("输入 %q 应原样返回，实得 %q", raw, got)
		}
	}
}

// TestAttrViewResult 组装出的 SessionResult 两侧都脱敏，且 current 为 nil 时不 panic。
func TestAttrViewResult(t *testing.T) {
	v := newAttrView(viewWorld, false)
	sess := &model.PlaySession{
		ID:            uuid.New(),
		CurrentState:  `{"hp":80,"suspicion":37}`,
		RevealedAttrs: `[]`,
	}
	if r := v.result(sess, nil); r.CurrentNode != nil {
		t.Error("current 为 nil 时 CurrentNode 应为 nil")
	}
	node := &model.StoryNode{StateSnapshot: `{"hp":80,"suspicion":37}`, RevealedSnapshot: `[]`}
	r := v.result(sess, node)
	if keysOf(t, r.Session.CurrentState)["suspicion"] != nil {
		t.Error("会话侧未脱敏")
	}
	if keysOf(t, r.CurrentNode.StateSnapshot)["suspicion"] != nil {
		t.Error("节点侧未脱敏")
	}
}
