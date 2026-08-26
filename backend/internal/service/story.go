package service

import (
	"backend/internal/model"
	"backend/internal/repository"
	"backend/pkg"
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
)

type StoryService struct {
	repo  *repository.StoryRepository
	likes *repository.StoryLikeRepository
}

func NewStoryService(repo *repository.StoryRepository, likes *repository.StoryLikeRepository) *StoryService {
	return &StoryService{repo: repo, likes: likes}
}

type StoryCreateInput struct {
	Title          string `json:"title"`
	Description    string `json:"description"`
	CoverURL       string `json:"cover_url"`
	WorldConfig    string `json:"world_config"`    // world_config JSON 字符串；空则留 DB default '{}'
	OpeningContent string `json:"opening_content"` // 预设开场正文，可空
}

// StoryUpdateInput 用指针字段区分「未传（nil，保持原值）」与「显式清空（&""）」，
// 以便富字段（world_config/opening_content）能被覆盖或清空，而不是像旧逻辑那样空串跳过。
type StoryUpdateInput struct {
	Title          *string `json:"title"`
	Description    *string `json:"description"`
	CoverURL       *string `json:"cover_url"`
	WorldConfig    *string `json:"world_config"`
	OpeningContent *string `json:"opening_content"`
}

func (s *StoryService) Create(creatorID uuid.UUID, input *StoryCreateInput) (*model.StoryResponse, error) {
	ctx := context.Background()

	// 草稿态用宽松校验：允许保存字段未填全的半成品，但结构性错误（键不对齐/类型错）仍拦下。
	if input.WorldConfig != "" {
		if err := pkg.ValidateWorldConfig([]byte(input.WorldConfig), false); err != nil {
			return nil, err
		}
	}

	story := &model.Story{
		CreatorID:      creatorID,
		Title:          input.Title,
		Description:    input.Description,
		CoverURL:       input.CoverURL,
		OpeningContent: input.OpeningContent,
		Status:         "draft",
	}
	if input.WorldConfig != "" {
		story.WorldConfig = input.WorldConfig
	}

	if err := s.repo.Create(ctx, story); err != nil {
		return nil, err
	}

	return story.ToResponse(), nil
}

// Get 读取作品详情。viewerID 是访问者（未登录传 uuid.Nil）：
// 非作者只能读 published，读草稿一律 404（不泄露存在性）；且拿到的是脱敏 world_config。
func (s *StoryService) Get(storyID, viewerID uuid.UUID) (*model.StoryResponse, error) {
	ctx := context.Background()

	story, err := s.repo.FindByID(ctx, storyID)
	if err != nil {
		return nil, err
	}
	if story == nil {
		return nil, nil
	}
	if err := canViewStory(story, viewerID); err != nil {
		return nil, err
	}

	resp := storyViewFor(story, viewerID)
	// liked 只在详情里给：列表页要它就得对整页作品再查一遍，而列表是匿名可读的。
	// 未登录时恒 false —— 匿名没有身份，"我赞过没有" 这个问题对他不成立。
	if viewerID != uuid.Nil {
		liked, err := s.likes.Liked(ctx, storyID, viewerID)
		if err != nil {
			return nil, err
		}
		resp.Liked = liked
	}
	return resp, nil
}

// Like / Unlike 点赞与取消赞，两者都幂等（重复调用不报错、不重复计数，见 repository）。
//
// 可见性复用 canViewStory：别人的草稿一律 404，赞一部不该被你看见的作品等于确认它存在。
// 作者赞自己的作品是允许的——为它单开一条规则，前端就要多维护一个"这按钮为什么是灰的"
// 的状态，收益抵不上。
func (s *StoryService) Like(storyID, userID uuid.UUID) (*model.LikeResult, error) {
	return s.setLike(storyID, userID, true)
}

func (s *StoryService) Unlike(storyID, userID uuid.UUID) (*model.LikeResult, error) {
	return s.setLike(storyID, userID, false)
}

func (s *StoryService) setLike(storyID, userID uuid.UUID, on bool) (*model.LikeResult, error) {
	ctx := context.Background()

	story, err := s.repo.FindByID(ctx, storyID)
	if err != nil {
		return nil, err
	}
	if err := canViewStory(story, userID); err != nil { // story == nil 也在这里转 404
		return nil, err
	}

	var count int
	if on {
		count, err = s.likes.Like(ctx, storyID, userID)
	} else {
		count, err = s.likes.Unlike(ctx, storyID, userID)
	}
	if err != nil {
		return nil, err
	}
	return &model.LikeResult{Liked: on, LikeCount: count}, nil
}

func (s *StoryService) Update(storyID, userID uuid.UUID, input *StoryUpdateInput) (*model.StoryResponse, error) {
	ctx := context.Background()

	story, err := s.repo.FindByID(ctx, storyID)
	if err != nil {
		return nil, err
	}
	if story == nil || story.CreatorID != userID {
		return nil, nil // 未找到或非属主，handler 统一转 404（不泄露作品是否存在）
	}

	// 已发布作品的更新走**严格校验**，与发布同一把尺子。
	// 草稿宽松是对的——写到一半本来就不完整；但发布之后还宽松，就等于开了一条
	// 绕过发布闸门的路：改一次就能把线上作品改成连发布都过不了的状态，玩家那边直接坏掉。
	// 编辑器的 save() 是整篇一次性 PUT（不是分段自动保存），所以收紧不会打断编辑流程。
	strict := story.Status == statusPublished

	if input.WorldConfig != nil {
		if err := pkg.ValidateWorldConfig([]byte(*input.WorldConfig), strict); err != nil {
			return nil, err
		}
		story.WorldConfig = *input.WorldConfig
	}
	if input.Title != nil {
		// 与 SetStatus 同理：world_config 校验管不到标题，已发布作品不能被改成空标题。
		if strict && strings.TrimSpace(*input.Title) == "" {
			return nil, pkg.BadRequest("已发布作品不能没有标题")
		}
		story.Title = *input.Title
	}
	if input.Description != nil {
		story.Description = *input.Description
	}
	if input.CoverURL != nil {
		story.CoverURL = *input.CoverURL
	}
	if input.OpeningContent != nil {
		story.OpeningContent = *input.OpeningContent
	}

	if err := s.repo.Update(ctx, story); err != nil {
		return nil, err
	}

	return story.ToResponse(), nil
}

// SetStatus 在 draft/published 间切换作品状态（仅属主）。
// 发布时对 world_config 做严格校验，挡住不完整作品上线，并记录首次发布时间；
// 取消发布只切状态、保留 PublishedAt（首发时间）。
func (s *StoryService) SetStatus(storyID, userID uuid.UUID, status string) (*model.StoryResponse, error) {
	ctx := context.Background()

	if status != "draft" && status != "published" {
		return nil, pkg.BadRequest("status 只能是 draft 或 published")
	}

	story, err := s.repo.FindByID(ctx, storyID)
	if err != nil {
		return nil, err
	}
	if story == nil || story.CreatorID != userID {
		return nil, nil
	}

	if status == "published" {
		// 标题是作品在书库里的唯一身份，空标题会在首页渲染成一张无字白卡。
		// world_config 校验管的是世界观，管不到这一层，这里单独兜住。
		if strings.TrimSpace(story.Title) == "" {
			return nil, pkg.BadRequest("发布前请先填写作品标题")
		}
		if err := pkg.ValidateWorldConfig([]byte(story.WorldConfig), true); err != nil {
			return nil, err
		}
		if story.PublishedAt == nil {
			now := time.Now()
			story.PublishedAt = &now
		}
	}
	story.Status = status

	if err := s.repo.Update(ctx, story); err != nil {
		return nil, err
	}
	return story.ToResponse(), nil
}

// ListMine 返回当前创作者的全部作品（含草稿）。
func (s *StoryService) ListMine(userID uuid.UUID, offset, limit int) (*StoryListResult, error) {
	ctx := context.Background()
	stories, total, err := s.repo.ListByCreator(ctx, userID, offset, limit)
	if err != nil {
		return nil, err
	}
	return toListResult(stories, total), nil
}

// Delete 删除作品（仅属主）。
//
// 「不存在」与「非属主」给**同一个** 404，理由同 Update/SetStatus：作品存不存在是作者
// 的私事。只是那两个返回 (nil, nil) 由 handler 转 404，而 Delete 只有 error 一个返回
// 通道，只能在这里就造出来——同一套语义，两种实现层，别当成风格不一致。
//
// ⚠️ 两条分支必须给同一个答案。只改非属主那条会变成「别人的作品→404、不存在→204」，
// 等于把存在性反过来泄露了。此前两条都 `return nil`，handler 照常回 204「删除成功」，
// 而一行都没删。
func (s *StoryService) Delete(storyID, userID uuid.UUID) error {
	ctx := context.Background()

	story, err := s.repo.FindByID(ctx, storyID)
	if err != nil {
		return err
	}
	if story == nil || story.CreatorID != userID {
		// 不复用 ownerOrNotFound：它的文案是英文 "not found"，会经 pkg.Error 直达
		// 前端的 role="alert" 横幅，在全中文界面里冒一句英文。
		return pkg.NotFound("作品不存在，或者它不属于你")
	}

	return s.repo.Delete(ctx, storyID)
}

type StoryListResult struct {
	Stories []model.StoryResponse `json:"stories"`
	Total   int64                 `json:"total"`
}

// List 供首页/浏览用：只返回已发布作品（草稿不外露）。
// List 列已发布作品。sort 只认 "plays"，其余一律按最新——**非法值回落而不是报错**：
// 这些是展示参数，一个拼错的 query 不该打死首页。
func (s *StoryService) List(offset, limit int, sort string) (*StoryListResult, error) {
	ctx := context.Background()
	order := repository.OrderRecent
	if sort == "plays" {
		order = repository.OrderPlays
	}
	stories, total, err := s.repo.ListPublished(ctx, offset, limit, order)
	if err != nil {
		return nil, err
	}
	return toListResult(stories, total), nil
}

func toListResult(stories []model.Story, total int64) *StoryListResult {
	responses := make([]model.StoryResponse, 0, len(stories))
	for i := range stories {
		responses = append(responses, *stories[i].ToResponse())
	}
	return &StoryListResult{Stories: responses, Total: total}
}
