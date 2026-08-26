package pkg

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
)

// BizCodeInvalidWorldConfig 是 world_config 结构校验失败的业务错误码。
const BizCodeInvalidWorldConfig = 10012

// worldConfigShape 是校验用的宽松解析形态：只取校验关心的字段。
// 与 service.WorldConfig / agent schema 对齐，但此处自解析以保持 pkg 零业务依赖
// （service 依赖 pkg，pkg 不可反向依赖 service，否则成环）。
type styleProfileShape struct {
	NarrativeDistance string   `json:"narrative_distance"`
	Rhythm            string   `json:"rhythm"`
	SensoryFocus      []string `json:"sensory_focus"`
	DialogueRule      string   `json:"dialogue_rule"`
	Avoid             []string `json:"avoid"`
}

type worldConfigShape struct {
	Background   string                    `json:"background"`
	Style        string                    `json:"style"`
	Rules        string                    `json:"rules"`
	Outline      string                    `json:"outline"`
	Characters   []map[string]any          `json:"characters"`
	InitialState map[string]any            `json:"initial_state"`
	Attributes   map[string]map[string]any `json:"attributes"`
	StyleProfile *styleProfileShape        `json:"style_profile"`
}

// ValidateWorldConfig 校验 world_config JSON 的结构一致性。
//
// 规则（原提炼自已删除的 seed_config_test.go，现由 worldvalidate_test.go 守着）：
//  1. JSON 合法；
//  2. strict 时 background/style/rules/outline 非空、characters 至少 1 个；
//  3. initial_state 键 ↔ attributes 键严格一一对应；
//  4. 每属性 type ∈ {number, scalar, set}；
//  5. 每属性有 initial，且 == initial_state[key]（DeepEqual）；
//  6. 类型-取值匹配：number→float64、scalar→string、set→[]any；
//  7. hidden/reveal 若存在必须为布尔；
//  8. max 若存在必须是正数，且只允许出现在 number 属性上（玩家端据此画进度条）。
//
// strict=false（存草稿）：跳过规则 2，允许保存字段未填全的半成品；其余照校。
// strict=true（发布）：全部规则，挡住不完整作品上线。
// 空串或 "{}" 在 strict=false 时视为「尚未配置」直接放行。
//
// 返回 nil 或 *AppError(BadRequest, BizCode 10012)，错误信息含具体字段/键名。
func ValidateWorldConfig(raw []byte, strict bool) *AppError {
	trimmed := trimSpace(raw)
	if len(trimmed) == 0 || string(trimmed) == "{}" {
		if strict {
			return NewBusinessErrorWithMessage(BizCodeInvalidWorldConfig, "世界观配置为空，发布前请先完成世界观设置")
		}
		return nil
	}

	var w worldConfigShape
	if err := json.Unmarshal(raw, &w); err != nil {
		return NewBusinessErrorWithMessage(BizCodeInvalidWorldConfig, "世界观配置不是合法 JSON："+err.Error())
	}

	// 规则 2：strict 下基本字段非空
	if strict {
		if w.Background == "" || w.Style == "" || w.Rules == "" || w.Outline == "" {
			return NewBusinessErrorWithMessage(BizCodeInvalidWorldConfig, "「背景」「基调」「规则」「大纲」均不得为空")
		}
		if len(w.Characters) == 0 {
			return NewBusinessErrorWithMessage(BizCodeInvalidWorldConfig, "至少需要一个角色")
		}
	}

	if err := validateStyleProfile(w.StyleProfile); err != nil {
		return err
	}

	// 规则 3：键集合严格一一对应
	for k := range w.InitialState {
		if _, ok := w.Attributes[k]; !ok {
			return NewBusinessErrorWithMessage(BizCodeInvalidWorldConfig,
				fmt.Sprintf("属性「%s」有初值但未声明，请在「属性」表中补上该行", k))
		}
	}
	for k := range w.Attributes {
		if _, ok := w.InitialState[k]; !ok {
			return NewBusinessErrorWithMessage(BizCodeInvalidWorldConfig,
				fmt.Sprintf("属性「%s」已声明但缺少初值，请在「属性」表中填写「初值」", k))
		}
	}

	// 规则 4-7：逐属性校验
	for k, spec := range w.Attributes {
		typ, _ := spec["type"].(string)
		switch typ {
		case "number", "scalar", "set":
		default:
			return NewBusinessErrorWithMessage(BizCodeInvalidWorldConfig,
				fmt.Sprintf("属性「%s」的「类型」无效（应为 number / scalar / set）：%v", k, spec["type"]))
		}

		initInSpec, hasInit := spec["initial"]
		if !hasInit {
			return NewBusinessErrorWithMessage(BizCodeInvalidWorldConfig,
				fmt.Sprintf("属性「%s」缺少「初值」", k))
		}
		initInState := w.InitialState[k]
		if !reflect.DeepEqual(initInSpec, initInState) {
			return NewBusinessErrorWithMessage(BizCodeInvalidWorldConfig,
				fmt.Sprintf("属性「%s」的两处初值不一致：声明处为 %v，初值表为 %v", k, initInSpec, initInState))
		}

		// 类型-取值匹配（JSON 反序列化：number→float64、scalar→string、set→[]any）
		switch typ {
		case "number":
			if _, ok := initInState.(float64); !ok {
				return NewBusinessErrorWithMessage(BizCodeInvalidWorldConfig,
					fmt.Sprintf("number 类型的属性「%s」，其「初值」应为数值", k))
			}
		case "scalar":
			if _, ok := initInState.(string); !ok {
				return NewBusinessErrorWithMessage(BizCodeInvalidWorldConfig,
					fmt.Sprintf("scalar 类型的属性「%s」，其「初值」应为文本", k))
			}
		case "set":
			if _, ok := initInState.([]any); !ok {
				return NewBusinessErrorWithMessage(BizCodeInvalidWorldConfig,
					fmt.Sprintf("set 类型的属性「%s」，其「初值」应为数组", k))
			}
		}

		if v, ok := spec["hidden"]; ok {
			if _, isBool := v.(bool); !isBool {
				return NewBusinessErrorWithMessage(BizCodeInvalidWorldConfig,
					fmt.Sprintf("属性「%s」的「隐藏」应为布尔值", k))
			}
		}
		if v, ok := spec["reveal"]; ok {
			if _, isBool := v.(bool); !isBool {
				return NewBusinessErrorWithMessage(BizCodeInvalidWorldConfig,
					fmt.Sprintf("属性「%s」的「门控」应为布尔值", k))
			}
		}

		// 规则 8：max 可选，仅 number 属性可有，且须为正数。
		// 它只影响玩家端「要不要画进度条」——没有上限就没有「满」的概念，
		// 前端据此决定画条还是只显示数字，不参与任何 delta 合并。
		if v, ok := spec["max"]; ok {
			if typ != "number" {
				return NewBusinessErrorWithMessage(BizCodeInvalidWorldConfig,
					fmt.Sprintf("属性「%s」不是 number 类型，不能设置「上限」", k))
			}
			f, isNum := v.(float64)
			if !isNum || f <= 0 {
				return NewBusinessErrorWithMessage(BizCodeInvalidWorldConfig,
					fmt.Sprintf("属性「%s」的「上限」应为正数：%v", k, v))
			}
		}
	}

	return nil
}

// styleProfileErr 拼一句作者能照着做的话：中文名 + 具体要求 + 真正管用的出路。
//
// ⚠️ 出路**不是**「重新生成世界观」——`/assist/world` 的 WorldDraft 里根本没有
// style_profile 这个字段，重生成不会碰它。管用的是让它过一遍编辑器的序列化：
// `editorStore.serializeStyleProfile` 会丢掉非法枚举、按上限截断数组与文本、
// 去首尾空白，所以在编辑器里重新保存一次就能把存量值规范成合法的。
func styleProfileErr(label, field, want string) string {
	return "风格档「" + label + "」" + want + "；该字段在编辑器中没有对应控件，重新打开本作品并保存一次即可自动规范化（字段 style_profile." + field + "）"
}

func styleProfileLabel(field string) string {
	switch field {
	case "sensory_focus":
		return "感官侧重"
	case "avoid":
		return "规避项"
	}
	return field
}

// ⚠️ style_profile 在本产品里**没有任何写入方**：编辑器无控件，`/assist/world`
// 的响应也不含该字段。它只会来自直接写库/直调 API 的数据或存量数据，读侧则由
// agent_client 透传给润色管线。这几条校验因此是防御性的，对编辑器建出来的作品
// 恒为 nil、恒通过。文案不能只报 JSON 键名——作者在界面上找不到那一栏。
func validateStyleProfile(profile *styleProfileShape) *AppError {
	if profile == nil {
		return nil
	}
	if profile.NarrativeDistance != "" && profile.NarrativeDistance != "close" && profile.NarrativeDistance != "medium" && profile.NarrativeDistance != "distant" {
		return NewBusinessErrorWithMessage(BizCodeInvalidWorldConfig, styleProfileErr("叙事距离", "narrative_distance", "必须为 close / medium / distant"))
	}
	if profile.Rhythm != "" && profile.Rhythm != "mixed" && profile.Rhythm != "tight" && profile.Rhythm != "relaxed" {
		return NewBusinessErrorWithMessage(BizCodeInvalidWorldConfig, styleProfileErr("叙事节奏", "rhythm", "必须为 mixed / tight / relaxed"))
	}
	if len(profile.SensoryFocus) > 3 {
		return NewBusinessErrorWithMessage(BizCodeInvalidWorldConfig, styleProfileErr("感官侧重", "sensory_focus", "最多 3 条"))
	}
	if len(profile.Avoid) > 5 {
		return NewBusinessErrorWithMessage(BizCodeInvalidWorldConfig, styleProfileErr("规避项", "avoid", "最多 5 条"))
	}
	if len([]rune(profile.DialogueRule)) > 160 || profile.DialogueRule != strings.TrimSpace(profile.DialogueRule) {
		return NewBusinessErrorWithMessage(BizCodeInvalidWorldConfig, styleProfileErr("对白规则", "dialogue_rule", "须为不含首尾空格的短文本（最多 160 字）"))
	}
	for _, pair := range []struct {
		name   string
		values []string
	}{{"sensory_focus", profile.SensoryFocus}, {"avoid", profile.Avoid}} {
		for _, value := range pair.values {
			if len([]rune(value)) == 0 || len([]rune(value)) > 48 || value != strings.TrimSpace(value) {
				return NewBusinessErrorWithMessage(BizCodeInvalidWorldConfig, styleProfileErr(styleProfileLabel(pair.name), pair.name, "每条须为不含首尾空格的非空短文本（最多 48 字）"))
			}
		}
	}
	return nil
}

// trimSpace 去掉字节切片首尾的 ASCII 空白，避免为空判定误差。
func trimSpace(b []byte) []byte {
	start, end := 0, len(b)
	for start < end && isSpace(b[start]) {
		start++
	}
	for end > start && isSpace(b[end-1]) {
		end--
	}
	return b[start:end]
}

func isSpace(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r'
}
