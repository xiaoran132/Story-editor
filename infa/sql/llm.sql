-- ============================================================
-- 005_llm.sql
-- BYOK 模块：用户 LLM 连接 / 环节绑定 / 平台设置
-- 依赖：001_users.sql
-- ============================================================
-- 设计要点（详见 docs/handoff.md §12）：
--   - 支持任意 OpenAI 兼容端点（base_url + api_key + model）。
--   - 连接（key/base_url）是**用户级**（llm_connections，账号里管一次）。
--   - 「用哪个模型」是**作品级**：每玩家在每作品各配各的（user_story_llm_configs）。
--   - 按环节分模型：write(续写/开场) / review(审校)；world(创作辅助)走编辑器临时连接。
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
    default_model   VARCHAR(80)  NOT NULL,          -- 该连接默认模型

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_llm_connections_user ON llm_connections(user_id);

-- ------------------------------------------------------------
-- 作品级模型配置：某玩家在某作品下，各环节选自己的哪条连接 + 哪个模型
-- ------------------------------------------------------------
CREATE TABLE user_story_llm_configs (
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    story_id    UUID        NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    -- bindings：{"write":{"conn":"<uuid>","model":"deepseek-reasoner"},"review":{...}}
    --   model 为空 → 回退所引用连接的 default_model；连接被删/非本人 → 回退平台。
    --   仅 write/review（world 属创作侧、走编辑器临时连接，不入此表）。
    --   用 TEXT 而非 JSONB（无需 JSON 查询，整行取用；规避 jsonb 拒绝空串）。
    bindings    TEXT        NOT NULL DEFAULT '{}',
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

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- admin 提权（最小门槛，无自动化）：手动指定第一个管理员，随后该用户需重新登录
-- （role 是 JWT 签发时快照）。
--   UPDATE users SET role = 'admin' WHERE username = '<你的用户名>';
-- ------------------------------------------------------------
