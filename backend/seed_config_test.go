package main

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/google/uuid"
)

// TestRichSeedStoriesConfig 校验所有种子作品的 world_config 逻辑一致性：
// JSON 合法、initial_state 键与 attributes 键一一对应、类型与取值匹配、initial 一致、
// hidden/reveal 为布尔。这样改 seed 配置后 `go test` 即可发现手滑（键漏声明、类型写错等）。
func TestRichSeedStoriesConfig(t *testing.T) {
	stories := richSeedStories(uuid.New())

	if len(stories) != 6 {
		t.Fatalf("期望 6 部种子作品，实际 %d 部", len(stories))
	}

	seenTitle := map[string]bool{}
	for _, s := range stories {
		if s.Title == "" {
			t.Errorf("作品标题不得为空")
		}
		if s.Title == "迷雾古堡" {
			t.Errorf("迷雾古堡 应已下线，不该出现在种子里")
		}
		if seenTitle[s.Title] {
			t.Errorf("作品标题重复：%s", s.Title)
		}
		seenTitle[s.Title] = true

		var world struct {
			Background   string                    `json:"background"`
			Style        string                    `json:"style"`
			Rules        string                    `json:"rules"`
			Outline      string                    `json:"outline"`
			Characters   []map[string]any          `json:"characters"`
			InitialState map[string]any            `json:"initial_state"`
			Attributes   map[string]map[string]any `json:"attributes"`
		}
		if err := json.Unmarshal([]byte(s.WorldConfig), &world); err != nil {
			t.Errorf("[%s] world_config 不是合法 JSON：%v", s.Title, err)
			continue
		}

		// 基本字段非空（内容质量靠人读，这里只挡结构性缺失）
		if world.Background == "" || world.Style == "" || world.Rules == "" || world.Outline == "" {
			t.Errorf("[%s] background/style/rules/outline 不得为空", s.Title)
		}
		if len(world.Characters) == 0 {
			t.Errorf("[%s] 至少应有一个 character", s.Title)
		}

		// 键集合：initial_state 与 attributes 必须严格一一对应
		for k := range world.InitialState {
			if _, ok := world.Attributes[k]; !ok {
				t.Errorf("[%s] 属性 %q 在 initial_state 里有值却未在 attributes 声明", s.Title, k)
			}
		}
		for k := range world.Attributes {
			if _, ok := world.InitialState[k]; !ok {
				t.Errorf("[%s] 属性 %q 已在 attributes 声明却不在 initial_state", s.Title, k)
			}
		}

		// 逐属性：类型合法、initial 与 initial_state 一致且与类型匹配、hidden/reveal 为布尔
		for k, spec := range world.Attributes {
			typ, _ := spec["type"].(string)
			switch typ {
			case "number", "scalar", "set":
			default:
				t.Errorf("[%s] 属性 %q 的 type 非法：%v", s.Title, k, spec["type"])
				continue
			}

			initInSpec, hasInit := spec["initial"]
			if !hasInit {
				t.Errorf("[%s] 属性 %q 缺 initial", s.Title, k)
				continue
			}
			initInState := world.InitialState[k]
			if !reflect.DeepEqual(initInSpec, initInState) {
				t.Errorf("[%s] 属性 %q 的 attributes.initial(%v) 与 initial_state(%v) 不一致",
					s.Title, k, initInSpec, initInState)
			}

			// 类型与取值匹配（JSON: number→float64, scalar→string, set→[]any）
			switch typ {
			case "number":
				if _, ok := initInState.(float64); !ok {
					t.Errorf("[%s] number 属性 %q 的初值应为数值，实际 %T", s.Title, k, initInState)
				}
			case "scalar":
				if _, ok := initInState.(string); !ok {
					t.Errorf("[%s] scalar 属性 %q 的初值应为字符串，实际 %T", s.Title, k, initInState)
				}
			case "set":
				if _, ok := initInState.([]any); !ok {
					t.Errorf("[%s] set 属性 %q 的初值应为数组，实际 %T", s.Title, k, initInState)
				}
			}

			if v, ok := spec["hidden"]; ok {
				if _, isBool := v.(bool); !isBool {
					t.Errorf("[%s] 属性 %q 的 hidden 应为布尔，实际 %T", s.Title, k, v)
				}
			}
			if v, ok := spec["reveal"]; ok {
				if _, isBool := v.(bool); !isBool {
					t.Errorf("[%s] 属性 %q 的 reveal 应为布尔，实际 %T", s.Title, k, v)
				}
			}
		}
	}
}
