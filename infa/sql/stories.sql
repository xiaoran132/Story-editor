-- ============================================================
-- 002_stories.sql
-- 作品模块：作品主表 / 标签 / 素材
-- 依赖：001_users.sql
-- ============================================================

-- ------------------------------------------------------------
-- 作品主表
-- 存储创作者发布的互动小说作品及其世界观配置
-- ------------------------------------------------------------
CREATE TABLE stories (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    title           VARCHAR(200) NOT NULL,
    description     TEXT,                   -- 作品简介，展示在详情页
    cover_url       TEXT,                   -- 封面图 OSS 路径

    -- 世界观与 AI 配置（JSONB 兼容创作者自定义扩展）
    world_config    JSONB       NOT NULL DEFAULT '{}',
    -- {
    --   "background":    "中世纪奇幻王国，魔法与科技并存...",
    --   "style":         "mystery",
    --   -- 风格枚举：mystery / romance / dark / comedy / neutral
    --   "rules":         "魔法消耗体力，普通人无法使用",
    --   "outline":       "故事大纲：核心悬念 + 三幕走向 + 关键剧情锚点 + 可能结局；作为 AI 导演的走向锚点（非线性脚本），据此把控整体节奏、避免分支越走越散",
    --   "characters": [
    --     {
    --       "id":          "char_001",
    --       "name":        "守卫长",
    --       "personality": "冷酷、尽职、有隐藏的善意",
    --       "role":        "npc",
    --       "avatar_asset_id": "uuid"   ← 关联 story_assets
    --     }
    --   ],
    --   "initial_state": {
    --     "hp":     100,
    --     "gold":   50,
    --     "charm":  30
    --     -- 创作者可自定义任意属性键
    --   },
    --   "attributes": {
    --     -- 声明每个属性键的合并类型，驱动 Go mergeState 与 Python normalize（两端语义必须一致）：
    --     --   number（数值累加）：state_delta 给增减量，如 {"hp": -10}
    --     --   scalar（覆盖式）  ：state_delta 给新值，  如 {"location": "王城"}
    --     --   set（集合增删）   ：state_delta 给 {"add":[...],"remove":[...]}
    --     -- 未声明类型的键由 Go 侧兜底推断（两侧皆数值则累加，否则覆盖），保证老作品兼容。
    --     "hp":       {"type": "number", "initial": 100},
    --     "location": {"type": "scalar", "initial": "村口"},
    --     "items":    {"type": "set",    "initial": []}
    --   },
    --   "protagonist": {
    --     "default_name": "旅行者",
    --     "description":  "一名身份不明的流浪者"
    --   },
    --   "llm": {
    --     "model":       "deepseek-chat",
    --     "temperature": 0.8,
    --     "allow_free_input": true
    --   }
    -- }

    -- 初始剧情（玩家进入时看到的第一段文字）
    opening_content TEXT,

    -- 状态流转：draft → published，发布后可下架为 archived
    status          VARCHAR(20) NOT NULL DEFAULT 'draft',
    -- 'draft'      草稿，仅创作者可见
    -- 'published'  已发布，社区可见
    -- 'archived'   已下架

    -- 付费配置（MVP 阶段预留字段，暂不实现业务逻辑）
    price_config    JSONB       NOT NULL DEFAULT '{"type": "free"}',
    -- {"type": "free"}
    -- {"type": "paid", "amount": 999}        ← 买断，单位分
    -- {"type": "per_depth", "per_node": 10}  ← 按节点深度计费

    -- 统计计数缓存（由应用层事务维护，避免频繁聚合查询）
    play_count      INT         NOT NULL DEFAULT 0,  -- 总游玩次数
    like_count      INT         NOT NULL DEFAULT 0,
    favorite_count  INT         NOT NULL DEFAULT 0,
    comment_count   INT         NOT NULL DEFAULT 0,
    share_count     INT         NOT NULL DEFAULT 0,

    published_at    TIMESTAMPTZ,                     -- 首次发布时间
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 社区首页：按发布时间倒序
CREATE INDEX idx_stories_published ON stories(published_at DESC)
    WHERE status = 'published';

-- 热度榜：综合游玩量 + 点赞
CREATE INDEX idx_stories_hot ON stories(play_count DESC, like_count DESC)
    WHERE status = 'published';

-- 好评榜
CREATE INDEX idx_stories_likes ON stories(like_count DESC)
    WHERE status = 'published';

-- 创作者管理自己的作品
CREATE INDEX idx_stories_creator ON stories(creator_id, created_at DESC);

CREATE TRIGGER trg_stories_updated_at
    BEFORE UPDATE ON stories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ------------------------------------------------------------
-- 标签字典表
-- 预置标签由运营维护，创作者发布时选择
-- ------------------------------------------------------------
CREATE TABLE story_tags (
    id          SERIAL      PRIMARY KEY,
    name        VARCHAR(20) NOT NULL UNIQUE,
    category    VARCHAR(20) NOT NULL DEFAULT 'genre',
    -- 'genre'   类型标签：悬疑 / 恋爱 / 科幻 / 校园 / 奇幻 / 历史
    -- 'theme'   主题标签：剧本杀 / 穿越 / 末世
    -- 'style'   风格标签：黑暗 / 轻松 / 虐心 / 甜宠
    sort_order  INT         NOT NULL DEFAULT 0,  -- 前端展示顺序
    use_count   INT         NOT NULL DEFAULT 0   -- 使用次数，方便推荐热门标签
);

-- 预置标签
INSERT INTO story_tags (name, category, sort_order) VALUES
    -- 类型
    ('悬疑',   'genre', 10),
    ('恋爱',   'genre', 20),
    ('科幻',   'genre', 30),
    ('奇幻',   'genre', 40),
    ('校园',   'genre', 50),
    ('历史',   'genre', 60),
    ('武侠',   'genre', 70),
    ('都市',   'genre', 80),
    -- 主题
    ('剧本杀', 'theme', 10),
    ('穿越',   'theme', 20),
    ('末世',   'theme', 30),
    ('克苏鲁', 'theme', 40),
    -- 风格
    ('黑暗',   'style', 10),
    ('甜宠',   'style', 20),
    ('轻松',   'style', 30),
    ('虐心',   'style', 40);


-- ------------------------------------------------------------
-- 作品与标签多对多关联
-- ------------------------------------------------------------
CREATE TABLE story_tag_relations (
    story_id    UUID    NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    tag_id      INT     NOT NULL REFERENCES story_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (story_id, tag_id)
);

-- 按标签查作品
CREATE INDEX idx_tag_relations_tag ON story_tag_relations(tag_id);


-- ------------------------------------------------------------
-- 作品素材表
-- 创作者上传的图片（封面/背景/立绘）和音频（BGM/音效）
-- 文件本体存 OSS，此表只存元数据
-- ------------------------------------------------------------
CREATE TABLE story_assets (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id    UUID        NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    uploader_id UUID        NOT NULL REFERENCES users(id),

    asset_type  VARCHAR(20) NOT NULL,
    -- 'cover'       作品封面（1:1 或 16:9）
    -- 'background'  场景背景图
    -- 'character'   角色立绘（建议透明 PNG）
    -- 'bgm'         背景音乐
    -- 'sfx'         音效

    name        VARCHAR(100),       -- 创作者自定义素材名，编辑器内引用用
    oss_key     TEXT        NOT NULL UNIQUE,  -- OSS 存储路径（唯一）
    url         TEXT        NOT NULL,         -- CDN 访问 URL

    -- 图片专属字段
    width       INT,                -- 像素宽
    height      INT,                -- 像素高

    -- 通用文件信息
    file_size   INT,                -- 字节数
    mime_type   VARCHAR(50),        -- 'image/png' / 'audio/mpeg' 等
    duration    INT,                -- 音频时长（秒），图片为 NULL

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 查某作品的所有素材（编辑器素材面板）
CREATE INDEX idx_assets_story_type ON story_assets(story_id, asset_type);
