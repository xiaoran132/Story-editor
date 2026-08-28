*当人工智能拥有超过人类的智力时，想象力也许是我们对于它们所拥有的唯一优势 ————刘慈欣*

### 写在正文之前

项目的最终目标是希望通过做出一款能够通过人的一个灵感，去不断衍生创造后续的故事。

---

# Story Editor · AI 互动剧情共创社区

> **当前阶段：Demo（0 用户）。** 游玩与创作两条闭环已打通：玩家可以逐字流式地玩一部 AI 互动剧情，回溯任意节点重开分支；作者可以用一句灵感生成完整世界观，经六段式编辑器打磨并发布。社区（评论/收藏/关注）、付费、多人共创是已完成设计、尚未实现的愿景。

**最后梳理：2026 年 8 月 27 日。** 本 README 是项目主入口，文档索引见文末「文档地图」。

## 这是什么

一个 AI 驱动的互动剧情平台。核心体验由两条链路构成：

**游玩。** 选择一部已发布作品进入会话，开场与续写的正文以 SSE **逐字流式**呈现（首字约 1s，不等结构化结果）。每一回合可以选 AI 推荐选项、**自由输入任意行动**（"假装投降然后偷钥匙"），或在无选项的叙事段直接「继续」。每次选择都会落成一个剧情树节点：属性随 `state_delta` 变化，滚动摘要持续沉淀前情。玩家可以**回溯到任意历史节点**重开分支——已有分支永不删除，逐字相同的选择直接复用旧节点、不重新生成；同层语义等价的新选择会被合并。属性系统支持三种类型（`number` 累加 / `scalar` 覆盖 / `set` 增删）和两种可见性标记：`hidden` 属性仅供 AI 幕后参考（怀疑度、警戒度），`reveal` 属性由剧情动态揭示（清点物资前不显示"物资"）。

**创作。** 从一句灵感开始：`/assist/world` 生成结构化世界观（背景/规则/大纲/角色/属性表，含文风档案 `style_profile`），作者在六段式编辑器里逐段微调——世界观、属性、开场正文（可 AI 起草 + 深度润色预览）、主题色相与天空剪影、发布体检。发布走严格校验（草稿宽松），发布后作品即出现在首页星系与作品馆，可被任何登录玩家游玩。

支撑两条链路的工程底座：

- **质量闭环**：Writer 流式写正文 → Structurer 生成选项/状态增量/摘要 → 可选审校（分级，只拦阻断级硬伤）。拒绝时有记忆写手在上一稿上修订，超限**降级交付**——绝不让玩家的回合失败。
- **BYOK 与计费**：任意 OpenAI 兼容端点。连接是账号级、模型是作品级、创作辅助是账号级；注册赠 1 元平台额度，按真实 token 用量计费扣减，用尽自带 key。Agent 服务不持有任何凭据，配置由 Go 随请求下发。
- **万象设计体系**：深空墨底 + 每作品一个色相（`--hue` 驱动整套 `oklch()` 派生色）+ 纯黑剪影，前端 14 条路由全部落在这套体系上。

## 已实现的能力

| 域 | 状态 | 内容 |
|---|---|---|
| 游玩 | ✅ | 流式开局/续写、推荐选项/自由输入、回溯、读档、删档、剧情树、状态合并、属性三态 |
| 创作编辑器 | ✅ MVP | 一句灵感生成世界观、表单微调、AI 开场起草、深度润色预览（显式采纳）、发布严格校验 |
| 账号 | ✅ | 注册/登录/JWT/资料/头像上传；游玩全组需登录 |
| BYOK 与计费 | ✅ | 连接管理（AES-GCM 加密）、作品级/账号级模型绑定、平台档（admin）与 token 计费流水 |
| 作品管理 | ✅ | CRUD、发布态切换、我的作品、参数化列表（排序/分页）、封面上传、点赞（幂等） |
| 社区 | 🚧 仅点赞 | 评论、收藏、关注、搜索、榜单未实现，`/community/*` 路由未注册（访问 404） |
| 付费、成就 | ❌ | 愿景设计见 [PRD](docs/prd.md) |

逐领域的「PRD 愿景 / SQL 蓝图 / 运行模型 / API+UI」四态对照见 [handoff §2.1](docs/handoff.md)。

## 架构

![三进程运行时架构](docs/img/runtime-architecture.svg)

三进程全栈 + PostgreSQL，进程边界即信任边界：

| 进程 | 职责 |
|---|---|
| **Next.js 前端** `:3000` | 游玩/创作 UI，Zustand 状态机；只消费 Go 的 `/api/v1` |
| **Go + Gin 后端** `:8080` | 账号、作品、游玩会话、节点树、状态合并、BYOK 解析与计费；唯一的业务编排与持久化入口（`handler → service → repository` 单向分层） |
| **Python FastAPI Agent** `:8001` | 唯一编排 `_stream_pipeline`：Writer 流式正文 → Structurer 元数据 → 可选审校；**不碰数据库、不持有任何 LLM 凭据** |
| **LLM** | DeepSeek 等 OpenAI 兼容端点；凭据在 Go 侧解密后随请求下发 |

**边界铁律**：浏览器绝不直连 Agent（无 CORS 无鉴权）；`play_sessions.current_state` 是会话当前状态的唯一事实来源（节点 `state_delta` 是增量、`state_snapshot` 用于回溯）；剧情树查询用 Postgres 递归 CTE，不在 Go 里递归。完整约束见 [CLAUDE.md](CLAUDE.md)。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Next.js 14 · React 18 · Zustand · CSS Modules（`oklch()` token 体系，无 UI 框架） |
| 后端 | Go · Gin · GORM（AutoMigrate 构建运行 schema）· JWT |
| Agent | Python FastAPI · openai SDK · logfmt 埋点 |
| 数据 | PostgreSQL（JSONB 世界观/状态、递归 CTE、部分唯一索引） |
| 部署 | nginx 反代（`/api/v1/ → 8080`，`/ → 3000`）+ docker compose |

## 快速启动（Windows）

### 前置条件

- Go 1.25+ / Python 3.12+ / Node.js 18+
- PostgreSQL（已创建 `story_editor` 数据库）
- 任一 OpenAI 兼容 LLM Key（DeepSeek 等）：三进程无 Key 也能启动，但生成类接口需要配置——注册后在 `/mine/settings` 添加自己的 BYOK 连接，或由 admin 在 `/admin` 配置平台档（注册赠 1 元平台额度，按 token 扣减）

### 一键启动

```powershell
.\scripts\dev.ps1              # 三进程各开一窗：Agent :8001 / 后端 :8080 / 前端 :3000
.\scripts\dev.ps1 -Only backend   # 单进程：agent | backend | frontend
```

首次运行自动复制示例环境文件并安装依赖。⚠️ 后端必须以 `backend/` 为工作目录（模板与配置路径是相对的），`dev.ps1` 已处理。

### 必需配置

| 文件 | 关键变量 |
|---|---|
| `agent/.env` | 无必填项（不持有 LLM 凭据）；可选 `AI_REVIEW_MAX_RETRIES`（默认 `2`）、按环节输出上限 `AI_WRITE/STRUCTURE/REVIEW_MAX_TOKENS` 等，见 `agent/.env.example` |
| `backend/.env` | `DB_*`、`JWT_SECRET`、`AGENT_URL`；可选 `UPLOAD_DIR`、`UPLOAD_MAX_MB` |
| `frontend/.env.local` | `NEXT_PUBLIC_API_BASE`，默认 `http://localhost:8080/api/v1` |

### 常用地址

- 游玩前端 <http://localhost:3000/> · 后端 API 根 <http://localhost:8080/api/v1>
- Agent 健康检查 <http://localhost:8001/health> · OpenAPI <http://localhost:8001/docs>

## 验证

没有 CI；以下本地门禁等价于提交前检查（前端 lint 是 `--max-warnings 0`，警告即失败）：

```powershell
cd backend;  go build ./...; go vet ./...; go test -race ./...    # 默认无需 PostgreSQL
cd frontend; npm.cmd run lint; npm.cmd run typecheck
cd agent;    .\.venv\Scripts\python.exe -m compileall -q app tests
             .\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

属性类型与状态合并的语义由 Go `mergeState` 与 Python `normalize` 的契约测试（`play_merge_test.go`）锁定。离线测试不能证明叙事好玩——真实质量靠多回合试玩与埋点观测，见 [handoff](docs/handoff.md) §8–§9。

## 仓库布局

| 目录 | 内容 |
|---|---|
| `backend/` | Go 后端（账号/作品/游玩会话/节点树/BYOK 计费） |
| `frontend/` | Next.js 游玩与创作前端（万象设计体系） |
| `agent/` | AI 生成服务（唯一编排在 `app/graph/story_graph.py` 的 `_stream_pipeline`） |
| `docs/` | handoff（当前事实）、design（技术设计）、prd（产品愿景）、context-strategy（长程记忆）、design/（UI 规范与静态原型） |
| `infa/sql/` | 数据模型蓝本，**启动时不执行**；运行 schema 只由 AutoMigrate 构建 |
| `scripts/` | `dev.ps1` 一键启动 |
| `templates/` | Gin 占位遗留，已被 `frontend/` 取代 |

## 关键实现决策

1. **剧情树而非线性文本**：每次选择生成 `story_nodes` 子节点；回溯只移动会话指针，不删除分支。
2. **状态 = JSONB 的「增量 + 快照」**：`state_delta` 记变化、`state_snapshot` 供节点级回溯、`current_state` 是唯一事实来源；属性类型由 `world_config.attributes` 声明，Go 与 Python 两侧语义由契约测试锁定。
3. **长程记忆 = 节点摘要打底 + 窗口兜底**：每节点存滚动 `summary`，续写注入最新摘要 + 最近两段原文，上下文长度与剧情深度近似无关。
4. **真流式 + 质量兜底**：正文逐字 SSE 先行，结构化元数据后置生成；审校分级只拦硬伤，超限降级交付，绝不阻断玩家回合。
5. **先留存、后扩张**：当前第一优先级是用真实多回合试玩给叙事质量结账（埋点已就位），社区 MVP 与付费排在其后。

## 文档地图

| 文档 | 用途 |
|---|---|
| [开发交接手册](docs/handoff.md) | **当前事实总览**：实现状态、代码入口、数据契约、运行/验证、风险与下一步 |
| [CLAUDE.md](CLAUDE.md) | 开发规范：分层边界、实现约定、可执行命令 |
| [AGENTS.md](AGENTS.md) | ZCode 会话自动加载的入口：CLAUDE.md 规则的中文精简镜像 |
| [视觉化技术导览](docs/visual-guide.html) | 运行时架构、续写数据流、质量闭环的图解 |
| [backend](backend/README.md) / [agent](agent/README.md) / [frontend](frontend/README.md) README | 模块事实 |
| [技术设计](docs/design.md) | 剧情树、JSONB、属性类型、Agent 演进等设计决策 |
| [上下文方案](docs/context-strategy.md) | 续写上下文构建（摘要 + 窗口 + RAG 演进） |
| [外部经验](docs/external-lessons.md) | MaiBot / DeepSeek Harness 的可吸纳设计：阶段二/三蓝本、触发判据、计费与 SSE 契约 |
| [产品需求](docs/prd.md) | 愿景与长期路线；**不等于已实现** |
| [产品分析底稿](docs/product-analysis.md) | 定位/竞品/风险/验证设计的思考稿（非承诺，定案后并入 PRD 并删除） |
| [infa/sql](infa/sql/) | 数据模型蓝本（部分表未落地） |

> **冲突判定顺序**：运行中的代码/测试 > `docs/handoff.md` > `CLAUDE.md` > 模块 README > `docs/design.md` > `docs/prd.md`。
