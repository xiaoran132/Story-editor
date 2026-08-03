# Story Editor · 后端（Go + Gin）

> 系统的**中枢与唯一写库者**。职责是账号鉴权、作品/节点树/游玩会话的持久化、属性状态合并，以及把生成请求**流式编排**给 Agent 服务再转发回前端。Agent 服务只产文、不碰库；前端只展示——**所有业务规则、归属校验、状态落库都在这里**。

## 先了解什么

- 项目全局状态与接手方式：[开发交接手册](../docs/handoff.md)（**当前事实总览**）
- 分层边界、实现约定、可执行命令：[CLAUDE.md](../CLAUDE.md)（**开发规范**）
- 剧情树 / JSONB 增量属性 / Agent 演进等技术决策：[设计思路](../docs/design.md)
- 完整数据模型蓝本（领先于 GORM 实现）：[infa/sql](../infa/sql/)

## 职责与边界

| 后端负责 | 后端不负责 |
|---|---|
| 鉴权（JWT）、会话归属、匿名 guest 回退与迁移 | 生成剧情正文、选项、`state_delta`、`summary`（Agent 做） |
| 作品、节点树、游玩会话的持久化与查询 | 决定文本质量、审校重写（Agent 做） |
| `state_delta` 合并、节点语义合并去重的落库 | 前端展示、状态字段的中文映射（前端做） |
| 把生成请求编排给 Agent、SSE 转发给前端 | 直连大模型（凭证下沉在 `agent/.env`） |

Agent 契约实现在 `internal/service/agent_client.go`；游玩编排在 `internal/service/play.go`。

## 分层架构

严格 `handler → service → repository` 单向依赖；`model`/`pkg` 为无状态通用层，禁写业务逻辑。依赖注入在 `main.go` 手动组装：config → db → repository → service → handler → 路由。

```text
backend/
├── main.go                     # 启动入口：config → db → 迁移 → seed → DI → 路由
├── seed.go                     # 幂等预置 guest 用户 + demo 作品
├── config/config.go            # viper 配置（环境变量 > config.yaml > 默认值）
├── internal/
│   ├── model/                  # 纯 GORM 模型 + ToResponse() DTO
│   ├── handler/                # 参数绑定 → 调 service → 统一响应
│   ├── service/                # 业务逻辑（play.go 编排 agent_client）
│   ├── repository/             # GORM 数据访问
│   └── middleware/             # auth（JWT）/ cors
└── pkg/                        # 无业务依赖：jwt / response / errors
```

> **必须在 `backend/` 目录下运行**：`main.go` 用 `LoadHTMLGlob("../templates/*")` 加载模板，viper 从 `./config` 与 `.` 查找 config.yaml——换目录会令模板路径失效。

## 快速开始

前置：**PostgreSQL 运行中**（默认 `localhost:5432`，库名 `story_editor`）。

```bash
cd backend
go run .                # 启动 :8080（自动迁移 + seed）

go build .              # 构建
go test ./...           # 测试（含 play_merge_test.go 属性合并契约）
go get <pkg> && go mod tidy   # 加依赖
```

Windows 下可用仓库根的 `.\scripts\dev.ps1`（默认一并拉起 Agent/后端/前端；`-Only backend` 只起后端）。

启动时会依次：启用 `pgcrypto` 扩展 → `AutoMigrate`（`User`/`UserCredential`/`Story`/`StoryNode`/`PlaySession`）→ `seed()` 幂等预置 guest 用户与 demo 作品。

## 配置

`config/config.go` 经 viper 读取，优先级 **环境变量 > config.yaml > 默认值**；`.env` 会先被加载进环境变量。模板见 `.env.example`。

| 变量 | 默认 | 说明 |
|---|---|---|
| `DB_HOST` | `localhost` | PostgreSQL 主机 |
| `DB_PORT` | `5432` | 端口 |
| `DB_USER` | `postgres` | 用户名 |
| `DB_PASSWORD` | `postgres` | 密码 |
| `DB_NAME` | `story_editor` | 库名 |
| `JWT_SECRET` | `change-me-in-production` | JWT 签名密钥（**生产必改**） |
| `SERVER_PORT` | `:8080` | 监听地址（含冒号） |
| `AGENT_URL` | `http://localhost:8001` | Agent 服务地址 |

## 路由

统一前缀 `/api/v1`；响应信封 `{ success, data, error, meta }`（用 `pkg` 辅助函数，勿直接 `c.JSON`）。

| 分组 | 鉴权 | 端点 |
|---|---|---|
| `/auth` | 部分 | `POST /register`、`POST /login`、`GET·PUT /profile`（AuthRequired） |
| `/stories` | 写需登录 | `POST·PUT·DELETE /`·`/:id`（AuthRequired）、`GET /`·`/:id`、`POST /:id/nodes` |
| `/nodes` | 写需登录 | `GET /:id/children`、`PUT·DELETE /:id`（AuthRequired） |
| `/play` | **AuthOptional** | 见下方 |
| `/community` | 写需登录 | `GET /stories`·`/:id`、`POST /:id/like`·`/comments`（**handler 桩，全 TODO**） |

### `/play`（游玩，匿名可玩）

挂 `AuthOptional`——带 token 归属登录用户，否则回退匿名 guest。

| 方法 | 路径 | 作用 |
|---|---|---|
| `POST` | `/sessions` | 建**空会话**（不同步生成开局，开局在游玩页触发） |
| `POST` | `/sessions/migrate` | **AuthRequired**：登录后领取匿名进度（只迁本浏览器上报且 guest 名下的会话） |
| `POST` | `/sessions/:id/opening/stream` | **SSE**：流式生成开局（幂等，见 `current_node=null` 时触发） |
| `GET` | `/sessions` | 读档列表（当前玩家/guest 历史会话，含 `story_title`） |
| `GET` | `/sessions/:id` | 会话详情（全部节点 + `current_node_id`，供重建剧情树） |
| `DELETE` | `/sessions/:id` | 删档（校验归属，事务级联删该局全部节点） |
| `POST` | `/sessions/:id/choice/stream` | **SSE**：流式选择/自由行动（delta/revise/done/error） |
| `POST` | `/sessions/:id/backtrack` | 回溯到历史节点（匿名可玩） |

## 关键设计约定

- **DTO**：每个 model 有 `ToResponse()` 返回对外 DTO，隐藏 `PasswordHash` 等敏感字段；handler 只返回 DTO。
- **Service 输入类型**：service 定义自己的输入结构体（如 `StoryCreateInput`），不依赖 handler 请求体，保持与 HTTP 解耦。
- **统一错误**：`pkg/errors.go` 的 `AppError`（`StatusCode` 不序列化、`BizCode` 序列化到 `error.code`）。handler 直接返回 service 的 error，由 `pkg.Error(c, err)` 断言处理。
- **JSONB 增量属性**：节点树用邻接表（`parent_id`/`depth`），属性变化存增量 `state_delta`；当前状态 = 路径上 delta 按类型合并。类型系统 `number`（累加）/`scalar`（覆盖）/`set`（增删）落在 `service.mergeState`，与 Agent 侧 `normalize` 严格对齐（见 `play_merge_test.go`）。
- **隐藏属性**（`"hidden": true`）：照常进状态、随 delta 合并、透传 Agent，但前端不显示、Agent 不在正文点名。
- **节点语义合并去重**（`play.go` 的 `tryMerge`）：续写落库前，同层子节点先按 `state_delta` 相等硬过滤，再调 Agent `/merge-check` 判语义等价，命中则复用不新建。

## 数据模型现状

GORM 目前只 `AutoMigrate` 五个模型：`User`、`UserCredential`、`Story`、`StoryNode`、`PlaySession`。完整数据蓝本在 [infa/sql](../infa/sql/)（领先于实现，社区的点赞/收藏/评论/计数字段等尚未落地）。修改数据契约时需同步核对对应 SQL。

## 修改后须同步的文档

完成代码任务后**必须**同步受影响文档，尤其 [docs/handoff.md](../docs/handoff.md)（当前事实）；改了分层/约定还需更新 [CLAUDE.md](../CLAUDE.md)。维护规则见 `docs/handoff.md` §10。
