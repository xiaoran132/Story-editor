-- ============================================================
-- 001_users.sql
-- 用户模块：用户主表 / 登录凭证 / 会话 / 关注关系
-- ============================================================

-- 启用 UUID 扩展
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------
-- 用户主表
-- 只存"身份"信息，登录凭证在 user_credentials 单独管理
-- ------------------------------------------------------------
CREATE TABLE users (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    username        VARCHAR(30) NOT NULL UNIQUE,    -- 唯一用户名，用于 @mention，注册后不可改
    nickname        VARCHAR(50) NOT NULL,            -- 显示名，可重复、可修改
    bio             VARCHAR(200),                    -- 个人简介

    -- 角色与状态
    role            VARCHAR(20) NOT NULL DEFAULT 'user',
    -- 'user'     普通用户
    -- 'creator'  认证创作者（后期审核开放）
    -- 'admin'    管理员
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active'   正常
    -- 'banned'   封禁
    -- 'deleted'  注销（软删除，保留数据）

    -- 统计计数缓存（冗余存储，避免频繁 COUNT 查询）
    -- 在关注/取关/发布等操作时用事务同步更新
    follower_count  INT         NOT NULL DEFAULT 0,
    following_count INT         NOT NULL DEFAULT 0,
    work_count      INT         NOT NULL DEFAULT 0, -- 已发布作品数

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_username ON users(username);
-- 只对非正常状态建索引，正常用户不走这个过滤
CREATE INDEX idx_users_status ON users(status) WHERE status != 'active';

-- updated_at 自动更新触发器
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ------------------------------------------------------------
-- 登录凭证表
-- 和 users 分开的原因：一个用户可以绑定多种登录方式
-- 密码登录 + 微信 + Github 都指向同一个 user_id
-- ------------------------------------------------------------
CREATE TABLE user_credentials (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    provider    VARCHAR(20) NOT NULL,
    -- 'password'  邮箱/手机号 + 密码
    -- 'wechat'    微信 OAuth（identifier = openid）
    -- 'github'    Github OAuth（identifier = github user id）
    -- 'google'    Google OAuth（identifier = google sub）

    -- provider='password' 时：identifier=邮箱或手机号，secret=bcrypt 哈希
    -- provider=OAuth 时   ：identifier=第三方唯一ID，secret=NULL
    identifier  VARCHAR(200) NOT NULL,
    secret      TEXT,                   -- 仅密码登录时存 bcrypt 哈希

    -- OAuth 额外数据，按需存取
    oauth_data  JSONB,
    -- {
    --   "access_token":  "...",
    --   "refresh_token": "...",
    --   "expires_at":    "2025-12-01T00:00:00Z",
    --   "raw_profile":   {...}   ← 第三方返回的原始用户信息
    -- }

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- 同一 provider 下 identifier 全局唯一
    UNIQUE (provider, identifier)
);

CREATE INDEX idx_credentials_user   ON user_credentials(user_id);
CREATE INDEX idx_credentials_lookup ON user_credentials(provider, identifier);

CREATE TRIGGER trg_credentials_updated_at
    BEFORE UPDATE ON user_credentials
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ------------------------------------------------------------
-- 用户会话表
-- 管理 JWT 的生命周期，支持主动吊销（封号、强制下线）
-- 每次请求在 Redis 校验 jti，未命中才查此表（减少 DB 压力）
-- ------------------------------------------------------------
CREATE TABLE user_sessions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- JWT 的 jti 字段 SHA-256 哈希值，不存明文 token
    token_hash      VARCHAR(64) NOT NULL UNIQUE,

    -- 设备与来源信息，用于安全审计
    device_info     JSONB,
    -- {
    --   "device":     "iPhone 15",
    --   "os":         "iOS 17.2",
    --   "ip":         "1.2.3.4",
    --   "user_agent": "Mozilla/5.0 ..."
    -- }

    expires_at      TIMESTAMPTZ NOT NULL,
    last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_revoked      BOOLEAN     NOT NULL DEFAULT false,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_user    ON user_sessions(user_id);
CREATE INDEX idx_sessions_token   ON user_sessions(token_hash);
-- 定时任务清理过期 session 时走此索引
CREATE INDEX idx_sessions_expires ON user_sessions(expires_at)
    WHERE is_revoked = false;


-- ------------------------------------------------------------
-- 关注关系表
-- ------------------------------------------------------------
CREATE TABLE user_follows (
    follower_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (follower_id, following_id),
    -- 不能关注自己
    CONSTRAINT chk_no_self_follow CHECK (follower_id != following_id)
);

-- 查"我关注了谁"走 follower_id
CREATE INDEX idx_follows_follower  ON user_follows(follower_id);
-- 查"谁关注了我"走 following_id
CREATE INDEX idx_follows_following ON user_follows(following_id);
