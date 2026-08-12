-- ============================================================
-- 004_community.sql
-- 社区模块：点赞 / 收藏 / 评论 / 节点路线分享
-- 依赖：001_users.sql / 002_stories.sql / 003_play.sql
-- ============================================================
-- ⚠️ 本目录**不参与建表**。运行库的事实源是 GORM `AutoMigrate`（见 backend/main.go 与
--    backend/internal/model/）。这里是**设计蓝图**，领先于实现，不是第二套隐式迁移机制。
--    哪些表真的在运行、哪些只是蓝图，见 docs/handoff.md §2.1 实现矩阵。

-- ------------------------------------------------------------
-- 作品点赞
-- ------------------------------------------------------------
CREATE TABLE story_likes (
    user_id     UUID        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    story_id    UUID        NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, story_id)
    -- 复合主键天然防重复点赞
);

-- 统计某作品的点赞数走 story_id（配合 stories.like_count 冗余字段）
CREATE INDEX idx_likes_story ON story_likes(story_id);

-- 点赞/取消点赞时同步更新计数（应用层事务）：
-- INSERT INTO story_likes ... ON CONFLICT DO NOTHING
--   RETURNING (触发则) UPDATE stories SET like_count = like_count + 1
-- DELETE FROM story_likes ...
--   (成功则) UPDATE stories SET like_count = like_count - 1


-- ------------------------------------------------------------
-- 作品收藏
-- ------------------------------------------------------------
CREATE TABLE story_favorites (
    user_id     UUID        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    story_id    UUID        NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, story_id)
);

-- 查某用户的收藏列表（个人主页"我的收藏"）
CREATE INDEX idx_favorites_user  ON story_favorites(user_id, created_at DESC);
-- 统计某作品被收藏数
CREATE INDEX idx_favorites_story ON story_favorites(story_id);


-- ------------------------------------------------------------
-- 评论表
-- 支持两层结构：顶层评论 + 一级回复（不做无限嵌套）
--
-- 顶层评论：parent_id = NULL
-- 回复评论：parent_id = 被回复的顶层评论 id
--           reply_to_user_id = 被回复的用户（楼中楼 @某人）
-- ------------------------------------------------------------
CREATE TABLE comments (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id        UUID        NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    user_id         UUID        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,

    -- 两层评论结构
    parent_id       UUID        REFERENCES comments(id) ON DELETE CASCADE,
    -- NULL    → 顶层评论
    -- 非NULL  → 回复某条顶层评论

    reply_to_user_id UUID       REFERENCES users(id) ON DELETE SET NULL,
    -- 楼中楼回复时，记录被 @ 的用户
    -- 例：A 发评论，B 回复 A → reply_to_user_id = A.id

    content         VARCHAR(500) NOT NULL,

    -- 点赞数（只允许对顶层评论点赞，不对回复点赞）
    like_count      INT         NOT NULL DEFAULT 0,

    -- 回复数缓存（只在顶层评论上有意义）
    reply_count     INT         NOT NULL DEFAULT 0,

    status          VARCHAR(20) NOT NULL DEFAULT 'visible',
    -- 'visible'  正常显示
    -- 'hidden'   被举报隐藏（审核中）
    -- 'deleted'  用户自己删除或管理员删除

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 作品详情页评论列表（顶层评论按时间倒序）
CREATE INDEX idx_comments_story ON comments(story_id, created_at DESC)
    WHERE parent_id IS NULL AND status = 'visible';

-- 展开某条顶层评论的所有回复
CREATE INDEX idx_comments_parent ON comments(parent_id, created_at ASC)
    WHERE parent_id IS NOT NULL;

-- 用户删除自己的评论 / 个人主页"我的评论"
CREATE INDEX idx_comments_user ON comments(user_id, created_at DESC);

CREATE TRIGGER trg_comments_updated_at
    BEFORE UPDATE ON comments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ------------------------------------------------------------
-- 评论点赞
-- 只允许对顶层评论（parent_id=NULL）点赞
-- ------------------------------------------------------------
CREATE TABLE comment_likes (
    user_id     UUID        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    comment_id  UUID        NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, comment_id)
);

CREATE INDEX idx_comment_likes_comment ON comment_likes(comment_id);


-- ------------------------------------------------------------
-- 节点路线分享（核心社交功能）
--
-- 玩家把自己走过的某条剧情路径分享出去
-- 其他玩家可以"载入"这条路线，直接从某个节点开始体验
-- 通过 end_node_id + 递归 CTE 可以还原完整路径
-- ------------------------------------------------------------
CREATE TABLE node_shares (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    sharer_id       UUID        NOT NULL REFERENCES users(id)          ON DELETE CASCADE,
    story_id        UUID        NOT NULL REFERENCES stories(id)        ON DELETE CASCADE,

    -- 分享路线的终点节点
    -- 通过此节点的 parent_id 链向上递归，可还原完整路径
    end_node_id     UUID        NOT NULL REFERENCES story_nodes(id)    ON DELETE CASCADE,

    -- 分享者给这条路线起的标题和描述
    title           VARCHAR(100),
    -- 例："五分钟速通好结局路线"
    description     VARCHAR(300),

    -- 预览节点（展示在分享卡片上的剧情片段，默认取 end_node_id）
    preview_node_id UUID        REFERENCES story_nodes(id) ON DELETE SET NULL,

    -- 统计数据
    view_count      INT         NOT NULL DEFAULT 0,   -- 被查看次数
    fork_count      INT         NOT NULL DEFAULT 0,   -- 从此路线分叉继续游玩的次数
    like_count      INT         NOT NULL DEFAULT 0,

    is_public       BOOLEAN     NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 某作品的所有公开分享（按热度/时间排序）
CREATE INDEX idx_shares_story_hot ON node_shares(story_id, like_count DESC)
    WHERE is_public = true;
CREATE INDEX idx_shares_story_new ON node_shares(story_id, created_at DESC)
    WHERE is_public = true;

-- 用户个人主页"我的分享"
CREATE INDEX idx_shares_sharer ON node_shares(sharer_id, created_at DESC);

CREATE TRIGGER trg_shares_updated_at
    BEFORE UPDATE ON node_shares
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ------------------------------------------------------------
-- 节点分享点赞
-- ------------------------------------------------------------
CREATE TABLE node_share_likes (
    user_id   UUID        NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
    share_id  UUID        NOT NULL REFERENCES node_shares(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, share_id)
);

CREATE INDEX idx_share_likes_share ON node_share_likes(share_id);


-- ------------------------------------------------------------
-- 载入分享路线的记录
-- 玩家点击"从此路线继续"时记录一条，用于统计 fork_count
-- ------------------------------------------------------------
CREATE TABLE node_share_forks (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    share_id    UUID        NOT NULL REFERENCES node_shares(id)  ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
    -- 分叉后创建的新 play_session
    session_id  UUID        REFERENCES play_sessions(id)         ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (share_id, user_id)  -- 同一用户对同一分享只记录一次 fork
);

CREATE INDEX idx_forks_share ON node_share_forks(share_id);
