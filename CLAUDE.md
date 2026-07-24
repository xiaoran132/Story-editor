# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 规则
1. 所有回复用中文
2. 在完成一个任务后，要及时更改文档库

## 项目概述

"AI驱动的互动剧情共创社区" — 用户既是玩家也是创作者，通过 AI Agent 协作完成剧情生成、体验、分享与再创作。

技术栈：Go-Gin + PostgreSQL/GORM（后端）、Next.js + React + Zustand（游玩前端，已搭建，见 `frontend/`）、Python FastAPI + LangGraph（agent 服务，独立进程，已实现并对接）。

## 构建与运行

```powershell
# 一键（Windows）：前置检查 + 独立窗口启动 Agent 服务(:8001)、后端(:8080)、前端(:3000)
.\scripts\dev.ps1        # 全部；.\scripts\dev.ps1 -Only ai | -Only backend | -Only frontend 单起
```

```bash
# 构建
cd backend && go build .

# 运行（需要 PostgreSQL 运行中；须在 backend/ 下）
cd backend && go run .

# 测试
cd backend && go test ./...

# 添加依赖
cd backend && go get <pkg> && go mod tidy

# Agent 服务（独立进程）
cd agent && uvicorn app.main:app --port 8001   # 详见 agent/README.md

# 前端（游玩，独立进程）
cd frontend && npm install && npm run dev   # :3000，详见 frontend/README.md
```

## 配置

`backend/config/config.go` 通过 viper 读取配置，优先级：**环境变量 > config.yaml > 默认值**。环境变量模板见 `backend/.env.example`。

默认值在 `config.setDefaults()`（私有）中定义：DB localhost/5432/postgres/story_editor、`SERVER_PORT=":8080"`、`AGENT_URL="http://localhost:8001"`。

> `main.go` 用 `LoadHTMLGlob("../templates/*")` 加载模板，且 viper 从 `./config` 与 `.` 查找 config.yaml——因此**必须在 `backend/` 目录下运行**（`cd backend && go run .`），否则模板路径失效。

## 架构模式

### 分层架构（扁平分层）

严格遵循 `handler → service → repository` 单向依赖。`model` 和 `pkg` 为无状态通用层，禁止包含业务逻辑。

```
backend/
├── main.go                     # 启动入口：config → db → DI → 路由 → 启动
├── config/config.go            # viper 配置管理
├── internal/
│   ├── model/                  # 纯 GORM 数据模型 + ToResponse() DTO
│   │   ├── user.go
│   │   ├── story.go
│   │   └── node.go
│   ├── handler/                # HTTP handler：参数绑定 → 调用 service → response
│   │   ├── user.go
│   │   ├── story.go
│   │   ├── node.go
│   │   └── community.go
│   ├── service/                # 业务逻辑层（纯 Go，不强绑 HTTP）
│   │   ├── user.go
│   │   ├── story.go
│   │   ├── node.go
│   │   └── agent_client.go     # HTTP 调用 Python agent 服务
│   ├── repository/             # 数据访问层（GORM 操作）
│   │   ├── user.go
│   │   ├── story.go
│   │   └── node.go
│   └── middleware/
│       ├── auth.go             # JWT Bearer 解析
│       └── cors.go             # 跨域
└── pkg/                        # 无业务依赖的工具包
    ├── jwt.go                  # JWT 生成/验证
    ├── response.go             # 统一响应格式
    └── errors.go               # AppError + 业务错误码
```

### 分层规则

1. `handler` 只能调用 `service`，负责请求绑定校验和响应
2. `service` 只能调用 `repository` 或 `agent_client`，负责业务逻辑
3. `repository` 只做数据库操作，接收/返回 `model` 结构体
4. `model` 只定义数据结构，禁止写业务逻辑
5. `pkg` 无任何业务依赖，可被任意层引用

### 依赖注入

在 `main.go` 中手动组装：config → database → repository → service → handler → 路由注册。

启动时 `main.go` 先执行 `CREATE EXTENSION IF NOT EXISTS pgcrypto`（`gen_random_uuid()` 依赖），再 `AutoMigrate` 当前五个模型：`User`、`UserCredential`、`Story`、`StoryNode`、`PlaySession`，随后 `seed()` 幂等预置 guest 用户 + demo 作品。`aiClient` 已注入 `PlayService`（`NewPlayService(sessionRepo, nodeRepo, storyRepo, aiClient)`），挂载在 `/api/v1/play/*`。

### 路由注册

直接在 `main.go` 中注册路由组：
- `/api/v1/auth/*` — 注册/登录/个人资料
- `/api/v1/stories/*` — 剧情 CRUD + 节点创建
- `/api/v1/nodes/*` — 节点查询/更新/删除
- `/api/v1/play/*` — 游玩会话：开局 `POST /sessions`、列表 `GET /sessions`（当前玩家/guest 的历史会话，含 `story_title`，供读档）、查询 `GET /sessions/:id`、删除 `DELETE /sessions/:id`（删档，校验归属后事务级联删该局全部节点）、选择 `POST /sessions/:id/choice`、回溯 `POST /sessions/:id/backtrack`（匿名可玩）
- `/api/v1/community/*` — 社区浏览/详情/点赞/评论（handler 桩）

### 统一错误处理

`pkg/errors.go` — `AppError` 有两个关键字段：
- `StatusCode` — HTTP 状态码（不序列化到 JSON）
- `BizCode` — 业务错误码（序列化到 JSON 的 `error.code`）

预定义 HTTP 错误：`BadRequest(msg)`, `Unauthorized(msg)`, `NotFound(msg)`, `Forbidden(msg)`, `Conflict(msg)`, `Internal(msg)`。
业务错误码 10001-10011 使用 `NewBusinessError(code)` 或 `NewBusinessErrorWithMessage(code, msg)`。

Handler 直接返回 service 层的 error，由 `pkg.Error(c, err)` 统一处理——通过类型断言提取 `AppError` 并正确设置 HTTP 状态码。

### 统一响应格式

所有 JSON 响应用 `pkg/` 辅助函数，不要直接调用 `c.JSON()`：
```
{ "success": true, "data": {...}, "error": null, "meta": {...} }
```
辅助函数：`pkg.Success`, `pkg.Created`, `pkg.SuccessWithMeta`, `pkg.Error`, `pkg.NoContent`。

### 鉴权

`middleware.AuthRequired(secret)` — 解析 Bearer JWT，设置 `c.Set("user_id", ...)`。
Handler 中用 `middleware.GetUserID(c)` 取值。

## 关键设计约定

### DTO 模式

每个 model 有 `ToResponse()` 方法返回对外 DTO（如 `UserResponse`），隐藏敏感字段（`PasswordHash` 等）。handler 只返回 DTO，不直接暴露 model。

### Service 输入类型

Service 层定义自己的输入结构体（如 `service.StoryCreateInput`、`service.NodeCreateInput`），不依赖 handler 的请求结构体。这保持了 service 与 HTTP 层的解耦。

### 剧情节点树 — JSONB 增量属性设计

核心设计思想（详见 `docs/设计思路.md`）：剧情属性（HP、金币、好感度等）完全由创作者自定义，后端不硬编码字段。

- **`StoryNode`** 使用邻接表（`parent_id`）形成树，`depth` 记录层级，`is_ending` 标记结局
- 属性变化存增量（`state_delta JSONB`），当前完整状态 = 路径上所有 delta 按类型合并 + 初始值
- Postgres 递归 CTE 做树查询（回溯路径、子树展开），不需要应用层递归
- 属性字段名对后端透明，直接用 JSONB 合并操作

**属性类型系统（number / scalar / set）**：创作者在 `world_config.attributes` 里声明每个属性键的类型，AI 与后端据此决定 `state_delta` 的格式与合并策略——
- `number`（数值累加，如 hp/gold）：delta 给增减量 `{"hp": -10}`，合并时相加；
- `scalar`（覆盖式，如 location/布尔 flag）：delta 给新值，后值覆盖前值；
- `set`（集合增删，如背包 items）：delta 给 `{"add": [...], "remove": [...]}`，按元素增删去重；
- **未声明类型的键**：向后兼容——两侧皆数值则累加，否则覆盖。

合并逻辑落在 `service.mergeState`（`play.go`），类型来自 `WorldConfig.AttrTypes()`；Python 侧 `graph/story_graph.py` 的 `normalize` 按同一套类型规整 LLM 输出（丢弃非法键、校验格式）。两端语义严格对齐，见 `play_merge_test.go`。

### AgentClient

`service/agent_client.go` 是独立的 HTTP 客户端，调用 Python agent 服务的 `/generate`、`/continue`、`/merge-check` 端点。不依赖 repository 层。`CheckMerge` 用通用的 `postInto`（`post` 是其 `AIResult` 特化包装）。

**节点语义合并去重**（`play.go` 的 `tryMerge`）：`MakeChoice` 调 `Continue` 生成后、新建节点前，取当前节点的同层子节点（`FindChildren`），先按 `state_delta` 规范 JSON 相等**硬过滤**（`deltaEqual`，省掉 AI 调用），再对候选调 `CheckMerge` 判语义等价；命中则复用该子节点（改 session 指针、`NodeCount` 不变），否则新建。保守策略：agent 不确定即不合并。

## PostgreSQL / GORM

- 驱动：`gorm.io/driver/postgres` + `gorm.io/gorm`
- 模块名：`backend`，Go 1.25
- 数据库名：`story_editor`（通过环境变量 DB_NAME 配置）
- 表由 GORM AutoMigrate 自动创建
- 模型定义在 `internal/model/`，使用 GORM 标签

## 当前实现状态

| 模块                                    | 状态 |
|---------------------------------------|------|
| 项目骨架（config, pkg, middleware, DI, 路由） | 完成 |
| User（注册/登录/JWT/个人资料）                  | 完成（bcrypt 密码 + user_credentials 凭证分离） |
| Story（CRUD + 列表）                      | 完成 |
| Node（节点创建/子节点/更新/删除）                  | 完成 |
| Play / 游玩会话（开局/选择/回溯 + 属性合并 + 会话列表）   | 完成（`PlayService` + `/play` 路由，含 `GET /sessions` 读档列表） |
| AgentClient + Agent 服务对接              | 完成（`agent/` + Go HTTP 编排，属性类型系统 number/scalar/set） |
| 游玩前端（Next.js）                         | 完成（`frontend/`：星图主题；作品选择、游玩、历史会话读档续玩+删档；已探索剧情线以发光星图展示、点击节点回溯；登录/注册未接入，沿用匿名 guest） |
| 节点语义合并去重                            | 完成（`MakeChoice` 生成后：同层子节点按 `state_delta` 相等硬过滤 + agent `/merge-check` 判语义等价 → 命中复用不新建，避免近义分支污染剧情树） |
| Community（浏览/详情/点赞/评论）                | handler 桩，全部 TODO |

## 数据库设计蓝本（infa/sql/）

`infa/sql/` 下的 SQL 文件是**完整数据模型的设计蓝本，领先于 Go 实现**——GORM 目前只 AutoMigrate 了其中一部分表。新增模块前应先对照对应 SQL：
- `users.sql`（001）— 用户 + 凭证分离
- `stories.sql`（002）— 作品 + world_config/initial_state
- `play.sql`（003）— `play_sessions`（存**完整状态快照** `current_state JSONB`，与节点树的增量 delta 设计互补）+ 节点树
- `community.sql`（004）— 点赞/收藏/评论/路线分享，含 `stories.like_count` 等冗余计数字段

## Agent 服务（agent/，Python FastAPI + LangGraph）

独立进程，Go 后端通过 `AGENT_URL`（默认 `http://localhost:8001`）调用，**不碰数据库**。DeepSeek 凭证下沉到 `agent/.env`，Go 侧不再直连大模型。

- `app/graph/story_graph.py` — LangGraph 工作流 `prepare → generate → normalize`（构建上下文/注入属性类型 → 调 LLM → 按类型规整 delta、过滤非法键、规整结局）
- `app/routers/generate.py` — `POST /generate`（开场）、`/continue`（续写）、`/merge-check`（节点语义合并判定），Go 的 `service/agent_client.go` 调这三个
- `app/routers/assist.py` — 创作辅助 `POST /assist/world|opening|polish|branches`（`/world` 会一并产出 `attributes` 类型声明）
- `app/schemas.py` — 请求/响应模型，`WorldConfig.attributes` 承载属性类型声明，与 Go 契约对齐
- `app/llm.py` — DeepSeek（OpenAI 兼容）客户端，强制 `response_format=json_object`

> 属性类型（number/scalar/set）的完整语义见上文「JSONB 增量属性设计」。`normalize` 对未在 `attributes` 里声明类型的键**透传**，由 Go 的 `mergeState` 兜底推断，保证无 `attributes` 的老作品照常工作。

启动：`cd agent && pip install -r requirements.txt && uvicorn app.main:app --port 8001`（详见 `agent/README.md`）。

> Go 的 `NewAgentClient(cfg.AgentURL)` 只做 HTTP 编排；`StartStory`/`Continue` 签名不变，`play` 链路无感。

## 待实现模块（按顺序）

1. ~~**save** — 会话续玩/读档~~ ✅ 已完成（`GET /play/sessions` 列表 + 前端首页读档续玩；登录接入后可按真实用户过滤）
2. ~~**ai** — agent_client 对接 Python agent 服务~~ ✅ 已完成（agent/ + Go 对接）
2.5. ~~**play** — 游玩会话链路~~ ✅ 已完成（`PlayService` + `/play` 路由，含回溯）
2.8. ~~**游玩前端** — Next.js 作品选择/游玩/读档~~ ✅ 已完成（`frontend/`）
3. **realtime** — WebSocket hub/client，AI 流式输出推送
4. **community** — 作品发布/搜索/排行榜/点赞/收藏/评论
5. **payment** — 付费解锁/打赏/分成（MVP 可 stub）
6. **achievement** — 成就系统

`templates/index.html` 为 Gin 模板占位，前端正式搭建后替换。