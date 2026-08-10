package pkg

import "testing"

// 一份完整合法的 world_config：覆盖 number/scalar/set 三型 + hidden + reveal + max。
const validWorld = `{
  "background": "孤岛上的一座旧宅，一夜之间管家离奇死亡。",
  "style": "本格推理，冷峻克制",
  "rules": "线索需实地勘察获得；怀疑度过高会被围攻。",
  "outline": "三幕：封闭现场→逐一排查→揭示真凶。",
  "characters": [{"name": "侦探", "role": "主角", "desc": "冷静的观察者"}],
  "initial_state": {"线索": 0, "体力": 80, "怀疑度": 0, "信任": 50, "location": "门厅", "证物": []},
  "attributes": {
    "线索":   {"type": "number", "initial": 0},
    "体力":   {"type": "number", "initial": 80, "max": 100},
    "怀疑度": {"type": "number", "initial": 0, "hidden": true},
    "信任":   {"type": "number", "initial": 50, "reveal": true},
    "location": {"type": "scalar", "initial": "门厅"},
    "证物":   {"type": "set", "initial": []}
  }
}`

func TestValidateWorldConfig_Valid(t *testing.T) {
	if err := ValidateWorldConfig([]byte(validWorld), true); err != nil {
		t.Fatalf("完整合法 world_config 不应报错，实际：%v", err)
	}
	if err := ValidateWorldConfig([]byte(validWorld), false); err != nil {
		t.Fatalf("完整合法 world_config（非严格）不应报错，实际：%v", err)
	}
}

func TestValidateWorldConfig_EmptyLenient(t *testing.T) {
	for _, raw := range []string{"", "  ", "{}", " {} "} {
		if err := ValidateWorldConfig([]byte(raw), false); err != nil {
			t.Errorf("非严格模式下空配置 %q 应放行，实际：%v", raw, err)
		}
		if err := ValidateWorldConfig([]byte(raw), true); err == nil {
			t.Errorf("严格模式下空配置 %q 应被拦下", raw)
		}
	}
}

func TestValidateWorldConfig_Rejects(t *testing.T) {
	cases := []struct {
		name   string
		raw    string
		strict bool
	}{
		{"非法JSON", `{不是json`, false},
		{"initial_state有键但attributes未声明", `{"initial_state":{"hp":10},"attributes":{}}`, false},
		{"attributes声明但initial_state缺", `{"initial_state":{},"attributes":{"hp":{"type":"number","initial":0}}}`, false},
		{"type非法", `{"initial_state":{"hp":0},"attributes":{"hp":{"type":"bogus","initial":0}}}`, false},
		{"缺initial", `{"initial_state":{"hp":0},"attributes":{"hp":{"type":"number"}}}`, false},
		{"initial与initial_state不一致", `{"initial_state":{"hp":5},"attributes":{"hp":{"type":"number","initial":0}}}`, false},
		{"number初值非数值", `{"initial_state":{"hp":"x"},"attributes":{"hp":{"type":"number","initial":"x"}}}`, false},
		{"scalar初值非字符串", `{"initial_state":{"loc":1},"attributes":{"loc":{"type":"scalar","initial":1}}}`, false},
		{"set初值非数组", `{"initial_state":{"bag":1},"attributes":{"bag":{"type":"set","initial":1}}}`, false},
		{"hidden非布尔", `{"initial_state":{"hp":0},"attributes":{"hp":{"type":"number","initial":0,"hidden":"yes"}}}`, false},
		{"reveal非布尔", `{"initial_state":{"hp":0},"attributes":{"hp":{"type":"number","initial":0,"reveal":1}}}`, false},
		{"max非数值", `{"initial_state":{"hp":0},"attributes":{"hp":{"type":"number","initial":0,"max":"100"}}}`, false},
		{"max非正数", `{"initial_state":{"hp":0},"attributes":{"hp":{"type":"number","initial":0,"max":0}}}`, false},
		{"非number属性声明max", `{"initial_state":{"loc":"门厅"},"attributes":{"loc":{"type":"scalar","initial":"门厅","max":10}}}`, false},
		{"严格模式缺基本字段", `{"initial_state":{},"attributes":{}}`, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := ValidateWorldConfig([]byte(tc.raw), tc.strict); err == nil {
				t.Errorf("应被拦下但通过了：%s", tc.name)
			} else if err.BizCode != BizCodeInvalidWorldConfig {
				t.Errorf("BizCode 应为 %d，实际 %d", BizCodeInvalidWorldConfig, err.BizCode)
			}
		})
	}
}
