package service

import (
	"encoding/json"

	"backend/internal/model"
)

// attrView 决定「这个玩家能看到哪些属性**值**」。
//
// 与 access.go 的 sanitizeWorldConfig 配套，两边缺一不可：那边挡的是作品详情里的
// 属性**声明**（这个作品有哪些属性、初值多少），这边挡的是游玩接口里的**实时值**
// （现在是多少）。只做一边等于没做——光挡声明，玩家从 current_state 照样读得到。
//
// 作者玩自己的作品不脱敏：hidden 是他自己写的，藏给他看没有意义。
type attrView struct {
	full   bool            // 不脱敏（作者本人，或作品没声明任何需要遮蔽的属性）
	hidden map[string]bool // hidden:true —— 全程不外发
	gated  map[string]bool // reveal:true —— 揭示之前不外发
}

// newAttrView 从世界观声明里提取需要遮蔽的键集。
func newAttrView(world WorldConfig, isAuthor bool) attrView {
	if isAuthor {
		return attrView{full: true}
	}
	v := attrView{hidden: map[string]bool{}, gated: map[string]bool{}}
	for k, spec := range world.Attributes {
		m, ok := spec.(map[string]any)
		if !ok {
			continue
		}
		if hidden, _ := m["hidden"].(bool); hidden {
			v.hidden[k] = true
			continue // hidden 优先：同时标了 reveal 也一律不外发
		}
		if reveal, _ := m["reveal"].(bool); reveal {
			v.gated[k] = true
		}
	}
	v.full = len(v.hidden) == 0 && len(v.gated) == 0
	return v
}

// state 过滤一份状态 JSON（current_state / state_delta / state_snapshot 同构）。
// revealed 是**该时点**已揭示的门控键集：会话用 revealed_attrs，节点用它自己的
// revealed_snapshot——按节点取才能保证回溯到发现之前会重新隐藏。
//
// 解析失败原样返回：这些 JSON 由 dumpState 产出、不会非法；真出现脏数据时
// 让玩家能继续玩比多挡一次更重要。
func (v attrView) state(raw string, revealed map[string]bool) string {
	if v.full || raw == "" {
		return raw
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return raw
	}
	changed := false
	for k := range m {
		if v.hidden[k] || (v.gated[k] && !revealed[k]) {
			delete(m, k)
			changed = true
		}
	}
	if !changed {
		return raw
	}
	out, err := json.Marshal(m)
	if err != nil {
		return raw
	}
	return string(out)
}

// session 产出脱敏后的会话 DTO。
func (v attrView) session(s *model.PlaySession) *model.SessionResponse {
	resp := s.ToResponse()
	if v.full {
		return resp
	}
	resp.CurrentState = v.state(resp.CurrentState, parseKeySet(s.RevealedAttrs))
	return resp
}

// node 产出脱敏后的节点 DTO。delta 与 snapshot 都按**该节点自身**的揭示集过滤，
// 否则玩家从历史时间线里就能提前读到后续才揭示的数值。
func (v attrView) node(n *model.StoryNode) *model.NodeResponse {
	resp := n.ToResponse()
	if v.full {
		return resp
	}
	revealed := parseKeySet(n.RevealedSnapshot)
	resp.StateDelta = v.state(resp.StateDelta, revealed)
	resp.StateSnapshot = v.state(resp.StateSnapshot, revealed)
	return resp
}

// result 组装单节点的 SessionResult（开局/续写/回溯共用）。current 可为 nil。
func (v attrView) result(s *model.PlaySession, current *model.StoryNode) *SessionResult {
	out := &SessionResult{Session: v.session(s)}
	if current != nil {
		out.CurrentNode = v.node(current)
	}
	return out
}

// parseKeySet 把 `["a","b"]` 解析成集合；空/脏数据一律当空集（宁可多挡）。
func parseKeySet(raw string) map[string]bool {
	set := map[string]bool{}
	if raw == "" {
		return set
	}
	var keys []string
	if err := json.Unmarshal([]byte(raw), &keys); err != nil {
		return set
	}
	for _, k := range keys {
		set[k] = true
	}
	return set
}
