-- ============================================================
-- 005_llm.sql
-- BYOK 模块：用户 LLM 连接 / 环节绑定 / 平台设置
-- 依赖：001_users.sql
-- ============================================================
-- ⚠️ 本目录**不参与建表**。运行库的事实源是 GORM `AutoMigrate`（见 backend/main.go 与
--    backend/internal/model/）。这里是**设计蓝图**，领先于实现，不是第二套隐式迁移机制。
--    哪些表真的在运行、哪些只是蓝图，见 docs/handoff.md §2.1 实现矩阵。
-- 设计要点（详见 docs/handoff.md §12）：
--   - 支持任意 OpenAI 兼容端点（base_url + api_key + model）。
--   - 连接（key/base_url）是**用户级**（llm_connections，账号里管一次）。
--   - 「用哪个模型」是**作品级**：每玩家在每作品各配各的（user_story_llm_configs）。
--   - 按环节分模型：write(续写/开场) / review(审校)（user_story_llm_configs）；world(创作辅助)是账号级配置（user_assist_llm_configs）。
--   - api_key 一律 AES-256-GCM 密文落库（Go pkg.Encrypt），读接口只回打码 hint。
--   - agent 不碰库；Go 按环节解析出有效配置后经请求体下发给 agent。
--   - 游玩烧玩家自己的 key，未配回退平台设置。
--   - 作者「推荐模型」存于 stories.world_config.recommended_models（仅标注展示，不入本文件建表）。

-- ------------------------------------------------------------
-- 用户 LLM 连接（每用户多条）
-- ------------------------------------------------------------
CREATE TABLE llm_connections (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    name            VARCHAR(50)  NOT NULL,          -- 展示名，如「我的 DeepSeek」
    provider        VARCHAR(20)  NOT NULL,          -- 标签：deepseek/openai/moonshot/custom
    base_url        VARCHAR(200) NOT NULL,          -- OpenAI 兼容端点
    api_key_cipher  TEXT,                           -- AES-256-GCM 密文（base64）
    models          TEXT         NOT NULL DEFAULT '[]',  -- 该连接可选模型 id 的 JSON 数组（无"默认模型"概念）

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_llm_connections_user ON llm_connections(user_id);

-- ------------------------------------------------------------
-- 创作辅助模型：某创作者的 world 环节用哪条连接的哪个模型。**账号级**，每用户一行。
-- 不挂作品——第一步「AI 生成世界观」时作品还不存在，没有 story_id 可挂；
-- 同一个创作者在所有作品里也确实用同一套辅助模型。
-- ------------------------------------------------------------
CREATE TABLE user_assist_llm_configs (
    user_id     UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    conn_id     UUID        REFERENCES llm_connections(id) ON DELETE SET NULL,  -- 空=走平台 world 档
    model       VARCHAR(80) NOT NULL DEFAULT '',                                -- conn_id 非空时必填
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 作品级模型配置：某玩家在某作品下，各环节选自己的哪条连接 + 哪个模型
-- ------------------------------------------------------------
CREATE TABLE user_story_llm_configs (
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    story_id    UUID        NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    -- bindings：{"write":{"conn":"<uuid>","model":"deepseek-reasoner"},"review":{...}}
    --   conn 非空时 model 必填（连接无默认模型）；model 为空/连接被删/非本人 → 回退平台。
    --   仅 write/review（world 属创作侧，见上面的 user_assist_llm_configs）。
    --   用 TEXT 而非 JSONB（无需 JSON 查询，整行取用；规避 jsonb 拒绝空串）。
    bindings    TEXT        NOT NULL DEFAULT '{}',
    -- review_enabled：本作品的「质量审校」开关，默认关。关=不下发 llm_review，agent 整段
    -- 跳过审校；开=review 环节必须解析得出配置，否则保存被拒（不静默降级成关闭）。
    -- 独立成列而非塞进 bindings——bindings 的类型是 map[string]StageBinding，硬塞布尔会污染类型。
    review_enabled BOOLEAN     NOT NULL DEFAULT FALSE,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, story_id)
);
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 平台 LLM 设置（全局，管理员管理；每环节一行）
-- 用户未配自带连接时的回退。
-- ------------------------------------------------------------
CREATE TABLE platform_llm_settings (
    stage           VARCHAR(20)  PRIMARY KEY,       -- write / review / world
    provider        VARCHAR(20)  NOT NULL,
    base_url        VARCHAR(200) NOT NULL,
    api_key_cipher  TEXT,
    model           VARCHAR(80)  NOT NULL,

    -- 单价：元 / 百万 token，admin 手工维护。
    -- **默认 0 = 永远扣不动额度**（安全的失败方向，但等于无限免费）；模型涨价也不会自动跟。
    price_in_per_mtok  DOUBLE PRECISION NOT NULL DEFAULT 0,
    price_out_per_mtok DOUBLE PRECISION NOT NULL DEFAULT 0,

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 平台额度用量流水（每次走**平台档**的 LLM 调用一行）
-- 玩家自带 key 的调用不记流水、不扣额度。余额本身在 users.credit_micro_cny，
-- 本表是审计与对账依据。
-- ------------------------------------------------------------
CREATE TABLE llm_usage_logs (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    story_id          UUID        REFERENCES stories(id) ON DELETE SET NULL,  -- 创作侧调用无作品归属，可空
    stage             VARCHAR(20)  NOT NULL,      -- write / review / world
    model             VARCHAR(80)  NOT NULL,
    prompt_tokens     INTEGER     NOT NULL,
    completion_tokens INTEGER     NOT NULL,
    cost_micro_cny    BIGINT      NOT NULL,       -- 微元（1e-6 元），整数存储避免浮点累加误差
    -- estimated：供应商没回 usage 时按字数估算的兜底值，对账时要能把它挑出来。
    estimated         BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 按用户查时间序（个人用量 / 对账）——与 GORM 的 idx_usage_user_time 复合索引一致。
CREATE INDEX idx_usage_user_time ON llm_usage_logs(user_id, created_at);

-- ------------------------------------------------------------
-- admin 提权（最小门槛，无自动化）：手动指定第一个管理员，随后该用户需重新登录
-- （role 是 JWT 签发时快照）。
--   UPDATE users SET role = 'admin' WHERE username = '<你的用户名>';
-- ------------------------------------------------------------
