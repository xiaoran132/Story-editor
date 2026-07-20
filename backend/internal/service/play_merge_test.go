package service

import (
	"reflect"
	"testing"
)

// TestMergeState 覆盖四类属性合并语义 + 边界。
func TestMergeState(t *testing.T) {
	types := map[string]string{
		"hp":       "number",
		"location": "scalar",
		"items":    "set",
	}

	cur := map[string]any{
		"hp":       float64(100),
		"location": "客栈",
		"items":    []any{"火把", "绳索"},
	}
	delta := map[string]any{
		"hp":       float64(-10),
		"location": "山洞",
		"items":    map[string]any{"add": []any{"钥匙"}, "remove": []any{"火把"}},
	}

	got := mergeState(cur, delta, types)

	if got["hp"] != float64(90) {
		t.Errorf("number 累加错误: hp = %v, 期望 90", got["hp"])
	}
	if got["location"] != "山洞" {
		t.Errorf("scalar 覆盖错误: location = %v, 期望 山洞", got["location"])
	}
	wantItems := []any{"绳索", "钥匙"} // 火把被 remove，绳索保留，钥匙 add
	if !reflect.DeepEqual(got["items"], wantItems) {
		t.Errorf("set 增删错误: items = %v, 期望 %v", got["items"], wantItems)
	}
}

// TestMergeStateSetDedupAndConflict set 去重，且 add/remove 同一元素时以 add 为最终态。
func TestMergeStateSetDedupAndConflict(t *testing.T) {
	types := map[string]string{"items": "set"}
	cur := map[string]any{"items": []any{"钥匙"}}
	delta := map[string]any{
		// 已有钥匙又 add 钥匙（去重），同时 remove 又 add 火把（add 优先）
		"items": map[string]any{"add": []any{"钥匙", "火把"}, "remove": []any{"火把"}},
	}
	got := mergeState(cur, delta, types)
	want := []any{"钥匙", "火把"}
	if !reflect.DeepEqual(got["items"], want) {
		t.Errorf("items = %v, 期望 %v", got["items"], want)
	}
}

// TestMergeStateUndeclaredInference 未声明类型：数值累加，否则覆盖（向后兼容老作品）。
func TestMergeStateUndeclaredInference(t *testing.T) {
	cur := map[string]any{"gold": float64(50), "title": "平民"}
	delta := map[string]any{"gold": float64(20), "title": "英雄", "mana": float64(30)}
	got := mergeState(cur, delta, map[string]string{}) // 无类型声明

	if got["gold"] != float64(70) {
		t.Errorf("未声明数值应累加: gold = %v, 期望 70", got["gold"])
	}
	if got["title"] != "英雄" {
		t.Errorf("未声明标量应覆盖: title = %v, 期望 英雄", got["title"])
	}
	if got["mana"] != float64(30) {
		t.Errorf("新键应写入: mana = %v, 期望 30", got["mana"])
	}
}

// TestMergeStateNumberInitFromDelta number 类型但原值缺失时，以增量为初值。
func TestMergeStateNumberInitFromDelta(t *testing.T) {
	types := map[string]string{"score": "number"}
	got := mergeState(map[string]any{}, map[string]any{"score": float64(5)}, types)
	if got["score"] != float64(5) {
		t.Errorf("缺初值的 number 应取增量: score = %v, 期望 5", got["score"])
	}
}

// TestAttrTypes 只收录显式声明的合法类型。
func TestAttrTypes(t *testing.T) {
	w := WorldConfig{Attributes: map[string]any{
		"hp":    map[string]any{"type": "number", "initial": float64(100)},
		"items": map[string]any{"type": "set"},
		"bad":   map[string]any{"type": "weird"}, // 非法类型，忽略
		"loose": "not-a-spec",                     // 非对象，忽略
	}}
	got := w.AttrTypes()
	want := map[string]string{"hp": "number", "items": "set"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("AttrTypes = %v, 期望 %v", got, want)
	}
}
