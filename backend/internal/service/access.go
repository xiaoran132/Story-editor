package service

import (
	"encoding/json"

	"backend/internal/model"
	"backend/pkg"

	"github.com/google/uuid"
)

// 作品状态。DB 默认 draft，发布走 SetStatus 严格校验。
const (
	statusDraft     = "draft"
	statusPublished = "published"
)

// canViewStory 判定「谁能读这部作品」：作者读自己的任何状态，其他人只读 published。
//
// 越权一律 404 而非 403——草稿的存在本身就是作者的私事，403 等于确认「这个 UUID 有作品」。
// 与 ownerOrNotFound 同一套语义。viewer 为 uuid.Nil（未登录）自然落入非作者分支。
func canViewStory(s *model.Story, viewer uuid.UUID) error {
	if s == nil {
		return pkg.NotFound("story not found")
	}
	if s.CreatorID == viewer && viewer != uuid.Nil {
		return nil
	}
	if s.Status != statusPublished {
		return pkg.NotFound("story not found")
	}
	return nil
}

// canPlay 判定「谁能对这部作品开局」，规则同 canViewStory：
// 作者可试玩自己的草稿，其他人只玩已发布；作品取消发布后非作者立即玩不了。
func canPlay(s *model.Story, player uuid.UUID) error {
	return canViewStory(s, player)
}

// readOnlyErr 是「作品已下架，这一局只能读完」的统一文案。
//
// 用 403 而不是 canViewStory 的 404：草稿返 404 是为了不泄露存在性，但走到这里的玩家
// 早就玩过这部作品，藏它没有意义——给一句能看懂的话比一个 404 有用得多。
func readOnlyErr() error {
	return pkg.Forbidden("作者已取消发布这部作品，这一局可以读完，但不能再推进")
}

// sanitizeWorldConfig 把 world_config 脱敏成「非作者可见」的版本：
//   - hidden 属性：连声明带初值整条抹掉——它本就该全程不露面；
//   - reveal 属性：保留声明（前端要据 type/max 画锁定占位），但抹掉 initial 与初值。
//
// **两处都要抹**：attributes[k].initial 和 initial_state[k] 存的是同一个数
// （pkg.ValidateWorldConfig 规则 5 强制它们相等），只删一处等于没删。
//
// 未知键原样保留（theme/tags/recommended_models 等）。解析失败时原样返回——
// 脱敏不该把一部作品变得打不开，与 parseWorld 的宽容策略一致。
func sanitizeWorldConfig(raw string) string {
	if raw == "" {
		return raw
	}
	var w map[string]any
	if err := json.Unmarshal([]byte(raw), &w); err != nil {
		return raw
	}
	attrs, ok := w["attributes"].(map[string]any)
	if !ok {
		return raw
	}
	initial, _ := w["initial_state"].(map[string]any)

	for k, v := range attrs {
		spec, ok := v.(map[string]any)
		if !ok {
			continue
		}
		if hidden, _ := spec["hidden"].(bool); hidden {
			delete(attrs, k)
			delete(initial, k)
			continue
		}
		if reveal, _ := spec["reveal"].(bool); reveal {
			delete(spec, "initial")
			delete(initial, k)
		}
	}

	out, err := json.Marshal(w)
	if err != nil {
		return raw
	}
	return string(out)
}

// storyViewFor 按访问者产出作品 DTO：作者拿完整 world_config（编辑器要用），
// 其他人拿脱敏版。
func storyViewFor(s *model.Story, viewer uuid.UUID) *model.StoryResponse {
	resp := s.ToResponse()
	if s.CreatorID != viewer || viewer == uuid.Nil {
		resp.WorldConfig = sanitizeWorldConfig(resp.WorldConfig)
	}
	return resp
}
