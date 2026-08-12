-- ============================================================
-- 003_play.sql
-- 游玩模块：游玩会话 / 剧情节点树
-- 依赖：001_users.sql / 002_stories.sql
-- ============================================================
-- ⚠️ 本目录**不参与建表**。运行库的事实源是 GORM `AutoMigrate`（见 backend/main.go 与
--    backend/internal/model/）。这里是**设计蓝图**，领先于实现，不是第二套隐式迁移机制。
--    哪些表真的在运行、哪些只是蓝图，见 docs/handoff.md §2.1 实现矩阵。

-- ------------------------------------------------------------
-- 游玩会话表
-- 一条记录 = 某个玩家开始玩某部作品的一局游戏
-- ------------------------------------------------------------
CREATE TABLE play_sessions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id        UUID        NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    player_id       UUID        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,

    -- 角色当前完整状态（实时快照，随节点推进更新）
    -- 存完整状态而非增量，方便直接读取、无需递归计算
    current_state   JSONB       NOT NULL DEFAULT '{}',
    -- {
    --   "hp":     80,
    --   "gold":   120,
    --   "charm":  35,
    --   "custom_flag": true
    --   -- 与 stories.world_config.initial_state 的键保持一致
    --   -- 创作者新增属性键时自动兼容，无需改表
    -- }

    -- 本会话已向玩家揭示的「揭示门控」属性键集（JSON 数组）
    -- 门控属性（world_config.attributes[k].reveal=true）被揭示前不在玩家端显示；
    -- 非门控属性不入此集、始终可见。随剧情推进增长，回溯时按节点快照恢复。
    revealed_attrs  JSONB       NOT NULL DEFAULT '[]',

    -- 玩家自定义的主角名（可覆盖作品默认名）
    protagonist_name VARCHAR(30),

    -- 当前所在节点（最后一次选择后停在哪里）
    current_node_id UUID,               -- 初始为 NULL，进入第一个节点后更新

    -- 会话状态
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active'    进行中
    -- 'ended'     已到达结局
    -- 'abandoned' 放弃（超过30天未活跃自动标记）

    -- 统计
    node_count      INT         NOT NULL DEFAULT 0,  -- 已经历的节点数（即深度）
    play_duration   INT         NOT NULL DEFAULT 0,  -- 累计游玩秒数

    last_played_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 玩家查自己的游玩记录
CREATE INDEX idx_sessions_player     ON play_sessions(player_id, last_played_at DESC);
-- 作品统计查询
CREATE INDEX idx_sessions_story      ON play_sessions(story_id);
-- 查活跃会话（续玩入口）
CREATE INDEX idx_sessions_active     ON play_sessions(player_id, story_id)
    WHERE status = 'active';

CREATE TRIGGER trg_sessions_updated_at
    BEFORE UPDATE ON play_sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ------------------------------------------------------------
-- 剧情节点表（核心数据结构）
--
-- 每次玩家做出选择 → AI 生成剧情 → 写入一条节点记录
-- 所有节点通过 parent_id 形成树状结构：
--
--   根节点（开局，parent_id=NULL）
--   ├── 选择A → 节点1（depth=1）
--   │   ├── 选择A1 → 节点3（depth=2）
--   │   └── 选择A2 → 节点4（depth=2，is_ending=true）
--   └── 选择B → 节点2（depth=1）
--       └── 选择B1 → 节点5（depth=2）
--
-- 查询场景：
--   1. 递归回溯路径（AI 上下文构建）→ 递归 CTE，沿 parent_id 向上
--   2. 渲染时间线面板         → 递归 CTE，从根向下展开整棵树
--   3. 热门节点统计           → visit_count 排序
-- ------------------------------------------------------------
CREATE TABLE story_nodes (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID        NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
    story_id        UUID        NOT NULL REFERENCES stories(id)       ON DELETE CASCADE,

    -- 树形结构
    parent_id       UUID        REFERENCES story_nodes(id) ON DELETE CASCADE,
    depth           INT         NOT NULL DEFAULT 0,
    -- depth=0 为根节点（开局），depth 每层 +1

    -- 玩家的选择（触发此节点的输入）
    choice_text     TEXT,
    -- 根节点（depth=0）此字段为 NULL
    -- 其他节点存玩家输入的原文，如"假装投降然后偷钥匙"

    -- AI 生成内容
    content         TEXT        NOT NULL,              -- 剧情正文

    -- ④节点树增量摘要：截至本节点的滚动前情提要（非玩家状态）
    -- 续写时取路径上最近一条非空 summary 渲染为【前情提要】+ 最近数段原文，
    -- 使上下文长度与剧情深度近似无关；老数据为空时回退滑动窗口。
    summary         TEXT        NOT NULL DEFAULT '',

    suggested_options JSONB     NOT NULL DEFAULT '[]', -- AI 推荐的下一步选项（纯行动文字，不预告后果）
    -- [
    --   {"text": "继续逃跑"},
    --   {"text": "原地等待"},
    --   {"text": "寻找盟友"}
    -- ]

    -- 属性变化（增量，只记本节点引起的变化）
    state_delta     JSONB       NOT NULL DEFAULT '{}',
    -- {"hp": -10, "gold": +50}
    -- 与 play_sessions.current_state 配合使用：
    --   current_state = current_state || (应用 delta 后的新值)

    -- 本节点发生时的完整状态快照
    -- 作用：回溯时直接恢复状态，无需递归累加所有 delta
    state_snapshot  JSONB       NOT NULL DEFAULT '{}',
    -- {"hp": 80, "gold": 120, "charm": 35, ...}

    -- 截至本节点已向玩家揭示的「揭示门控」属性键集（JSON 数组）
    -- 作用：回溯时随 state_snapshot 一并恢复可见性——回到"发现前"的节点会重新隐藏该属性
    revealed_snapshot JSONB     NOT NULL DEFAULT '[]',
    -- ["物资"]

    -- 标记
    is_ending       BOOLEAN     NOT NULL DEFAULT false,  -- 是否结局节点
    ending_type     VARCHAR(20),
    -- NULL        非结局
    -- 'good'      好结局
    -- 'bad'       坏结局
    -- 'neutral'   中性结局
    -- 'hidden'    隐藏结局

    -- 社区统计（仅 is_public=true 的节点参与统计）
    is_public       BOOLEAN     NOT NULL DEFAULT false,
    visit_count     INT         NOT NULL DEFAULT 0,
    -- 多少玩家经过此节点（用于"XX% 的玩家选择了此路线"）

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 核心索引1：查某局游戏的节点树（最高频）
-- 递归 CTE 展开树时走此索引
CREATE INDEX idx_nodes_session_parent ON story_nodes(session_id, parent_id);

-- 核心索引2：向上回溯路径
-- WHERE id = ? 走主键，WHERE parent_id = ? 走上面的索引，已覆盖

-- 社区统计：某作品热门节点排行
CREATE INDEX idx_nodes_story_visits ON story_nodes(story_id, visit_count DESC)
    WHERE is_public = true;

-- 结局节点统计（用于展示"本作品有 N 个结局"）
CREATE INDEX idx_nodes_endings ON story_nodes(story_id)
    WHERE is_ending = true AND is_public = true;


-- ------------------------------------------------------------
-- 常用查询示例（注释说明，供开发参考）
-- ------------------------------------------------------------

-- 1. 从当前节点向上回溯完整路径（用于构建 AI 上下文）
-- WITH RECURSIVE path AS (
--     SELECT id, parent_id, depth, choice_text, content, state_delta
--     FROM story_nodes
--     WHERE id = :current_node_id
--
--     UNION ALL
--
--     SELECT n.id, n.parent_id, n.depth, n.choice_text, n.content, n.state_delta
--     FROM story_nodes n
--     INNER JOIN path p ON n.id = p.parent_id
-- )
-- SELECT * FROM path ORDER BY depth ASC;


-- 2. 展开某局游戏的完整节点树（用于渲染时间线面板）
-- WITH RECURSIVE tree AS (
--     SELECT id, parent_id, depth, choice_text, content, is_ending,
--            ARRAY[id]::uuid[] AS path_ids
--     FROM story_nodes
--     WHERE session_id = :session_id
--       AND parent_id IS NULL
--
--     UNION ALL
--
--     SELECT n.id, n.parent_id, n.depth, n.choice_text, n.content, n.is_ending,
--            t.path_ids || n.id
--     FROM story_nodes n
--     INNER JOIN tree t ON n.parent_id = t.id
--     WHERE n.session_id = :session_id
-- )
-- SELECT * FROM tree ORDER BY depth, created_at;


-- 3. 玩家回溯到某节点（不删数据，直接从该节点继续分叉）
-- 操作步骤（应用层）：
--   a. 找到目标节点，读取其 state_snapshot
--   b. UPDATE play_sessions SET current_state = :state_snapshot,
--                                current_node_id = :target_node_id
--   c. 后续新节点以 target_node_id 为 parent_id 正常插入即可
--   d. 原有的"另一个分支"节点仍然保留，不删除


-- 4. 写入新节点 + 更新会话状态（应用层用事务保证原子性）
-- BEGIN;
--   INSERT INTO story_nodes(...) VALUES (...) RETURNING id;
--   UPDATE play_sessions
--     SET current_state   = :new_state,
--         current_node_id = :new_node_id,
--         node_count      = node_count + 1,
--         last_played_at  = NOW()
--     WHERE id = :session_id;
-- COMMIT;
