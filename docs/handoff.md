# Story Editor 开发交接手册

> **用途**：帮助新的开发者或 AI 在一次阅读后理解“现在能做什么、代码在哪里、哪些约束不能破、下一步该做什么”。
> **状态快照日期**：2026 年 7 月 28 日。若本手册与运行代码冲突，优先以代码和测试为准，并在修正后同步本手册。

## 1. 一句话定位与当前边界

Story Editor 的长期愿景是“AI 驱动的互动剧情共创社区”：用户既可以游玩，也可以创作、分享和再创作。

**已打通游玩 + 创作两条闭环**。游玩：登录 → 作品 → 会话 → AI 生成 → 状态变化/剧情树 → 回溯与读档。创作(MVP)：一句话灵感 →(Go 转发)agent `/assist/world` → 结构化表单微调 → `/assist/opening` → 完整开场的深度润色预览 → 存草稿/发布 → 首页作为可玩作品出现。社区未实现、路由未注册。

不要把 [prd.md](prd.md) 的愿景功能当作已实现功能。当前实现状态应以本手册、`CLAUDE.md` 和代码为准。

## 2. 当前完成度

| 域 | 已完成 | 未完成或限制 |
|---|---|---|
| 用户 | 后端注册/登录/JWT/资料、凭证分表；**前端登录接入完成**（游玩需登录，匿名与会话迁移已移除，见 §9.2）；**我的空间 `/mine`（空间/我的作品/历史记录/消息/设置五页）**，设置页含资料 + 头像 + BYOK 连接管理；**BYOK 已接入生成**（连接=账号级、模型=作品级，见 §12）；**注册赠 1 元平台额度 + 按 token 计费扣减**；头像上传 | OAuth/密码找回未做；**充值服务未做**（额度用尽只能自带 key）；单价需 admin 手填；旧 `User.LLMKeyCipher`（单 key）已废弃、列留孤儿 |
| 作品 | Story CRUD（列表/详情 LEFT JOIN users 带出 `creator_name` 作者昵称，只读投影）、作品列表、世界观/初始状态 JSON；**创作编辑器(MVP)**：`world_config`/`opening_content` 可写入、运行时校验(`pkg.ValidateWorldConfig`，**草稿宽松、已发布严格**——发布时校验，且**更新已发布作品走同一把尺子**，否则改一次就能把线上作品改成连发布都过不了的状态)、发布态切换、我的作品列表、assist Go 转发；**完整开场深度润色预览**（文风档案 `style_profile` 是它的可选输入，但目前无任何写入方，见 §9.2）；**封面上传（`/uploads/image` + `cover_url`，见 §14）**；**`GET /stories` 参数化**（`sort`/`limit`/`offset`，见 §7.1）；**`play_count` 有写入路径了**（开场落库成功时经 `StoryCounter` 窄接口自增，见 §9.2） | `/assist/branches` 编辑内接入未做 |
| 游玩 | 开局、续写、自由输入、回溯、读档、删档、剧情树、状态合并；质量审校可开关（默认关）；**全组需登录，草稿仅作者可玩**；**hidden/未揭示 reveal 的数值不外发**（§9.2） | **匿名不能玩**（额度挂账号，详情页拦截并引导登录）；真实环境下的多回合质量/延迟指标尚未沉淀 |
| Agent | **流式生成(SSE)**、属性类型规整（含 hidden）、故事大纲导演、滚动摘要、审校分级 + 有记忆修订 + 超限降级交付 | RAG、多 Agent fan-out、独立 director/recall/write 子图未做 |
| 前端 | **万象设计体系全量落地（见 §13）**，14 条路由全在新体系上：`/` 3D CSS 星系(四种排布 + 拖拽惯性 + 2.6s 开屏)、`/works` 作品馆、`/story/[id]`、`/play/[id]`(三栏舞台 + 状态轨 + 选项坞 1/2/3 快捷键 + 星图抽屉)、`/create`·`/edit/[id]` 六段式编辑器(天空即完成度)、`/login` 天空阶梯、`/mine` 五页、`/admin`、`not-found`，以及 `/community`·`/mine/inbox` 两个**零假数据**的开发中页。正文逐字流式(无首字下沉)、属性三态可见性(hidden 全程不露面)、进度条按 `max` 声明画、按作品配模型、每作品一个 `--hue` 染色 | 社区功能未做；**无前端自动化测试、无 CI**（`.github/` 只剩 ESLint），闸门是本地 lint/typecheck/build + 真机走查 |
| 社区 | **点赞**（`POST/DELETE /stories/:id/like`，幂等，`story_likes` 唯一索引去重，与 `stories.like_count` 同事务） | `/community/*` 路由**未注册**（访问 404）；评论、收藏、关注、搜索、排行榜均未实现 |
| 商业化 | SQL 蓝本中有概念 | 付费、打赏、分成、成就未做 |

### 2.1 实现矩阵：一个领域在四个地方各是什么状态

PRD 写愿景、`infa/sql` 写蓝图、GORM 建真表、API/UI 才是玩家摸得到的东西——四者进度不同步是本项目最容易踩的坑（比如 `community.sql` 表设计齐全，但一张表都没建、路由也没注册）。这张表就是为了让「某个东西到底做了没有」一眼可查。

| 领域 | PRD 目标 | SQL 蓝图 | GORM 运行模型（`main.go` AutoMigrate） | API / UI | 权威细节 |
|---|---|---|---|---|---|
| 用户与凭证 | §4 角色体系 | `users.sql` ✅ 同步 | `User`、`UserCredential` | 注册/登录/JWT/资料/头像 ✅ | §12 |
| 作品 | §1.1 创作 | `stories.sql` ✅ 同步 | `Story` | CRUD + 编辑器 + 发布严格校验 ✅ | §2 |
| 剧情树 | §1.1 游玩 | `play.sql` ✅ 同步 | `StoryNode` | **只由游玩链路写**；创作侧节点 CRUD 已下线（§9.2） | §5.1 |
| 游玩会话 | §1.1 游玩 | `play.sql` ✅ 同步 | `PlaySession` | 全链路 ✅，需登录 | §6 |
| BYOK 连接 | —（工程需求） | `llm.sql` ✅ | `LLMConnection` | `/llm/connections` ✅ | §12 |
| 作品级模型绑定 | — | `llm.sql` ✅ | `UserStoryLLMConfig` | `/llm/story-config/:storyId` ✅ | §12 |
| 平台模型设置 | — | `llm.sql` ✅ | `PlatformLLMSetting` | `/admin/llm/platform` ✅（需 admin） | §12 |
| 用量与额度 | §1.4 商业化 | `llm.sql` + `users.credit_micro_cny` ✅ | `LLMUsageLog` + `User.CreditMicroCNY` | 按 token 计费扣减 ✅；**充值未做** | §12 |
| 上传素材 | §1.1 | **无表**（文件落磁盘） | 无 | `/uploads/image` ✅；孤儿文件无回收（§9.2） | §14 |
| 点赞 | §1.2 | `community.sql` 仅蓝图；实际表由 `AutoMigrate` 从 `StoryLike` 建 | `StoryLike` | `POST/DELETE /stories/:id/like` ✅（幂等，`AuthRequired`） | §7.1 |
| 社区（评论/收藏/关注） | §1.2 | `community.sql` **仅蓝图** | **无** | **路由未注册**，访问 404 | §9.2 |
| 付费 / 打赏 / 成就 | §1.4 | 仅 `stories.price_config` 字段 | 无 | 无 | `prd.md` §1.4 |

**运行中的模型就是这 10 个**：`User`、`UserCredential`、`Story`、`StoryLike`、`StoryNode`、`PlaySession`、`LLMConnection`、`PlatformLLMSetting`、`UserStoryLLMConfig`、`LLMUsageLog`。⚠️ `AutoMigrate` 之外还有一条**显式 DDL**：部分唯一索引 `uniq_root_per_session`（GORM 的模型标签表达不了 `WHERE parent_id IS NULL`），由 `main.go` 在 `AutoMigrate` 之后调 `EnsureRootIndex` 建，见 §9.2。`infa/sql/` 里其余表（community 全部、素材/关注等）**没有任何一张进入运行库**——该目录不参与建表，见其文件头声明。

## 3. 系统架构与职责

```mermaid
flowchart LR
  FE["Next.js 前端 :3000\n游玩 UI / Zustand"] -->|"HTTP + SSE /api/v1"| BE["Go + Gin 后端 :8080\n业务编排 / 持久化"]
  BE -->|"GORM"| DB[("PostgreSQL\n剧情树 / 会话 / JSONB")]
  BE -->|"HTTP / SSE"| AG["FastAPI :8001\n流式生成与质量审校"]
  AG -->|"OpenAI-compatible"| LLM["DeepSeek"]
```

> **视觉版：**[当前运行时架构](visual-guide.html#runtime) 展示进程边界和唯一写库入口；[一次选择的流式续写](visual-guide.html#player-stream) 展示 `delta` / `revise` / `done` 的时序；[Agent 质量闭环](visual-guide.html#agent-quality) 明确当前单流水线与多 Agent 愿景的区别。它们用于快速定位，路由与契约细节仍以本手册和源码为准。

### 3.1 三个进程的硬边界

- **`frontend/`**：只调用 Go 后端的 `/api/v1`，不持有数据库或 DeepSeek 凭证。
- **`backend/`**：唯一的业务编排与持久化入口。负责鉴权、作品/节点/会话、状态合并、Agent HTTP 调用。
- **`agent/`**：无数据库依赖。输入世界观、历史、状态和选择，输出结构化剧情 JSON。审校超限降级交付（不硬失败），仅 LLM 非法 JSON/网络异常才报错。

### 3.2 后端分层约定

```text
handler → service → repository
```

各层职责、模块边界（模块化单体：禁止跨模块直接依赖对方 repository，跨模块只读走 `service/ports.go` 的窄接口）、RBAC 与归属校验的完整规则都在 [`../CLAUDE.md`](../CLAUDE.md)，这里不再复述。**新增代码不得绕过这条依赖方向。**

## 4. 代码地图：从需求找到实现

| 想改什么 | 优先阅读的文件 |
|---|---|
| 后端启动、路由、依赖注入、迁移 | `backend/main.go` |
| 环境变量、DSN、Agent 地址 | `backend/config/config.go`、`backend/.env.example` |
| 游玩业务主流程 | `backend/internal/service/play.go` |
| Agent HTTP 契约 | `backend/internal/service/agent_client.go` |
| 剧情节点、会话、故事模型 | `backend/internal/model/node.go`、`play_session.go`、`story.go` |
| 所有游玩 API 入口 | `backend/internal/handler/play.go` |
| Agent 图和上下文拼接 | `agent/app/graph/story_graph.py` |
| Agent 生成/审校提示词 | `agent/app/prompts.py` |
| Agent 请求响应模型 | `agent/app/schemas.py` |
| Agent 配置 | `agent/app/config.py`、`agent/.env.example` |
| Agent 路由和错误语义 | `agent/app/routers/generate.py`、`assist.py` |
| 前端页面和游玩状态机 | `frontend/app/`、`frontend/store/playStore.ts` |
| 前端 API 信封与类型 | `frontend/lib/api.ts`、`frontend/lib/types.ts`、`frontend/lib/state.ts` |
| 完整设计的 SQL 蓝本 | `infa/sql/users.sql`、`stories.sql`、`play.sql`、`community.sql` |

## 5. 数据模型与不可破坏的约定

### 5.1 当前持久化模型

| 模型 | 关键字段 / 作用 |
|---|---|
| `User` / `UserCredential` | 用户资料与密码/OAuth 凭证分离；密码不出响应 |
| `Story` | 作品元信息；`world_config`（含 `background`/`style`/`rules`/`outline`(故事大纲，导演走向锚点)/`characters`/`initial_state`/`attributes`/`theme`(作品级主题皮肤 id，见 §13)/`recommended_models`）、`opening_content`、`price_config` 为 JSON/文本配置 |
| `StoryNode` | 邻接表剧情树。`parent_id`、`depth`、`choice_text`、`content`、`suggested_options`、`state_delta`、`state_snapshot`、`revealed_snapshot`(截至本节点已揭示的门控属性,供回溯恢复可见性)、`summary` |
| `PlaySession` | 会话归属与当前指针；`current_node_id`、`current_state`、`revealed_attrs`(本会话已揭示的门控属性键集)、`node_count`、`status` |

上表只列游玩链路的四个核心模型；**运行中共 9 个**，与 SQL 蓝图、API 的对应关系见 §2.1 实现矩阵。

### 5.2 状态规则

- `play_sessions.current_state`：会话**当前完整状态的唯一事实来源**。
- `story_nodes.state_delta`：本节点相对父节点的变化，仅用于解释和重建。
- `story_nodes.state_snapshot`：截至本节点的完整快照，服务于回溯/展示。
- `story_nodes.summary`：截至本节点的滚动前情提要，服务于后续续写，不是玩家状态。
- `play_sessions.revealed_attrs` / `story_nodes.revealed_snapshot`：本会话/截至本节点已向玩家揭示的「揭示门控」属性键集，服务于属性可见性（见 §5.3）；与 `current_state`/`state_snapshot` 同步更新、回溯一并恢复。
- 回溯只移动会话当前节点与状态（含可见性）；既有节点和分支绝不删除。

### 5.3 属性类型

`world_config.attributes` 可声明属性类型；Agent 与 Go 必须使用相同语义：

| 类型 | `state_delta` 形态 | 合并含义 |
|---|---|---|
| `number` | `{"hp": -10}` | 累加 |
| `scalar` | `{"location": "王城"}` | 覆盖 |
| `set` | `{"items": {"add": ["钥匙"], "remove": ["火把"]}}` | 集合增删 |

未声明类型的老数据由 Go 侧兼容推断；不要在 Agent 或前端各自发明不同的合并规则。

**隐藏属性 `"hidden": true`**：标了 hidden 的属性是"仅供 AI 参考的幕后仪表"（怀疑度/警戒度等）。它照常进 `current_state`、随 delta 合并、透传给 agent；差别在展示与提示：
- 玩家端：`AttrBar` 过滤不显示（前端另发 `GET /stories/:id` 取 `world_config` 解析 hidden 键）；
- Agent：`prepare` 的 `_hidden_attrs` 把隐藏键注入提示词，令 LLM 照常更新 delta、但不得在 content/options 点名或报数，只用剧情间接体现；
- 创作：`WORLD_SYSTEM` 允许 AI 生成世界观时主动把压力型属性标 hidden。
- 是未来"玩家自选隐藏属性"的地基。

**揭示门控属性 `"reveal": true`**（区别于 hidden 的"永不显示"）：标了 reveal 的属性玩家**发现前不显示、发现后显示**，由 AI 动态揭示。链路：
- 数据：per-session `play_sessions.revealed_attrs` + per-node `story_nodes.revealed_snapshot`（回溯恢复可见性）。属性值仍照常在 `current_state` 里被 AI 幕后追踪。
- Agent：`prepare` 的 `_write_reveal_gated` 把"尚未揭示的门控属性"注入提示，令 AI 在剧情真正让玩家发现/清点时，把该键放进输出的 `revealed` 列表；`normalize` 按声明白名单校验 `revealed`。
- Backend：`applyContinueResult`/`StartOpeningStream` 把 `revealed` 并入会话集与节点快照；`Backtrack` 从节点快照恢复。
- 前端：`AttrBar` 可见性 = 非 hidden ∧（非门控 ∨ 已揭示）；`playStore` 从 `world_config` 解析门控键、从 `session.revealed_attrs` 取已揭示键。
- 典型用途：解决"开局就显示 initial_state 全部属性"的违和（如《最后的深夜电台》"物资"标 reveal，整理物资前不显示，避免"整理却从5变4"的矛盾——见 §9.2）。

## 6. 最重要的运行流程

### 6.1 开局与续写

> 先看 [一次选择的流式续写图](visual-guide.html#player-stream) 再阅读下方逐步说明：它强调“正文先流、完整结果后持久化”的边界，以及审校重写时的 `revise` 事件。

开局与续写**都走流式**。关键：`StartSession` 只建**空会话**（无根节点、`current_node_id=null`、`node_count=0`），开局正文改由游玩页触发流式生成——这样开局也能逐字流到浏览器（生成发生在游玩页，而非建会话时）。建空会话由**作品详情页**（`/story/:id`）的「开始新游戏」触发。

```text
前端（作品详情页）POST /play/sessions          （只建空会话，立即返回，current_node=null）
  → PlayService.StartSession → 建 PlaySession（无根节点）

前端进入游玩页 GET /play/sessions/:id → 发现 current_node=null →
前端 POST /play/sessions/:id/opening/stream   （流式开局，SSE）
  → PlayService.StartOpeningStream（幂等：根节点已存在则直接 done 返回）
  → 无 opening_content：Go 调 Agent POST /generate/stream 真逐字流式
    有 opening_content：正文作单帧 delta + POST /opening/complete 补选项/summary
  → 流结束建根 StoryNode + 回填 current_node_id/node_count=1
  → done 帧携带持久化后的 SessionResult

前端 POST /play/sessions/:id/choice/stream     （流式续写，SSE；续写只有这一条路径）
  → PlayService.MakeChoiceStream
  → loadChoiceContext：回溯出 history（带 summary）
  → reuseExistingChild：同层子节点里有逐字相同的选择 → 直接挪指针，不生成不扣费，到此为止
  → Go 调 Agent POST /continue/stream，SSE 逐帧转发给前端：
       delta（正文增量）/ revise（审校拒绝，前端清空重来）
  → 流结束拿到完整 AIResult 后 applyContinueResult：
       合并 state_delta → 同层语义去重（tryMerge）→ 未命中才新建 StoryNode → 更新会话
  → done 帧携带持久化后的 SessionResult
```

流式与审校共存（Writer / Structurer 分责）：Agent 先由 Writer 流式输出纯正文，结束后由复用同一 `llm_write` 配置的 Structurer 生成 options、state_delta、summary 等元数据；再规整并执行可选 review。拒绝则发 revise，并完整重跑 Writer → Structurer → Reviewer（上限同 `AI_REVIEW_MAX_RETRIES`）。Writer + Structurer 的累计用量回传为 `usage.write`，不新增模型配置或计费阶段。⚠️ **Structurer 与 Reviewer 必须跑在工作线程里**（`await asyncio.to_thread(...)`）：`_stream_pipeline` 是 async generator，由 `StreamingResponse` 在事件循环里迭代，而它们走的 `chat_json` 是同步阻塞 I/O——直接调用会卡住整个 uvicorn worker，一个玩家在结构化，其他玩家的逐字流全部停摆（也会让 §9.1 的 `elapsed_ms`/`ttfb_ms` 混进别人的排队时间）。并发上限由 loop 默认 executor 决定，是 `min(32, cpu+4)`，不是 anyio 的 40。**语义**去重只能在流结束后做（依赖完整 delta/options）；逐字相同的选择则在生成之前就被 `reuseExistingChild` 截住，一个 token 都不烧（两级机制见 `docs/design.md`「分支复用与节点去重」）。前端游玩页 `load()` 见 `current_node=null` 即触发 `startOpening()`，有按 sessionId 的去重守卫防严格模式双触发。

### 6.2 Agent 质量闭环


```text
prepare
  → generate（剧情、选项、state_delta、summary）
  → review（低温 AI 审查，分级：只挡阻断级硬伤）
       ├─ passed=true       → normalize → 返回
       ├─ passed=false 未超限 → 有记忆写手在上一稿上修订（writer_msgs 追加上一稿+反馈）
       └─ 超限            → deliver_degraded → normalize（降级交付最后一稿，degraded=1）
```

`AI_REVIEW_MAX_RETRIES` 默认是 `2`：最多初稿加两次重写。**超限不再硬失败**，而是**降级交付最后一稿**（`deliver_degraded` 节点）——理由：属性/`state_delta` 只是辅助 AI 分析与玩家参考的手段，轻微不精确可容忍，宁可交付略有瑕疵也绝不让玩家操作失败。仅 LLM 非法 JSON（重试耗尽）或网络异常才是真失败、转 HTTP 502。

审校采**分级**：只拦**阻断级硬伤**——正文与设定/前情/选择直接矛盾、正文无实质推进、非结局无选项或选项雷同、`summary` 篡改关键不可逆事实、JSON 结构坏；而 `state_delta` 数值精度、未遂动作是否记账等模糊情形一律放行（`STORY_SYSTEM` 已加"未遂动作不记账"规则消歧）。

### 6.3 长程记忆

续写优先注入：**最近一条非空 `summary` + 最近两段原文 + 当前状态/选择**。这让上下文长度与剧情深度近似无关；老会话无摘要时回退为“开局 + 最近窗口”的滑动窗口。详细方案见 [context-strategy.md](context-strategy.md)。

## 7. 对外接口地图

所有 Go API 的根路径为 `/api/v1`，响应信封统一为：

```json
{"success": true, "data": {}, "error": null, "meta": null}
```

### 7.1 Go 后端

| 域 | 接口 |
|---|---|
| 鉴权 | `POST /auth/register`、`POST /auth/login`、`GET/PUT /auth/profile`（登录签发的 JWT 现携带 `role` 快照） |
| 作品 | `POST/GET /stories`（列表收 `sort=recent\|plays`、`limit`(默认 50，>100 夹到 100)、`offset`(默认 0) 三个查询参数；**非法值一律回落默认、不返 400**——展示参数不该让一个拼错的 query 打死首页，且负 `offset` 会让 Postgres 的 `OFFSET -1` 直接语法错变 500。排序带稳定次级键 `play_count DESC, created_at DESC, id`）、`GET/PUT/DELETE /stories/:id`（`GET` 挂 `AuthOptional`：作者可读自己的草稿，其他人只读 published、越权返 **404 不返 403**；非作者拿到脱敏 `world_config`。`DELETE` 对「不存在」与「非属主」给**同一个 404**——此前两者都静默 204，handler 回「删除成功」而一行都没删；两条必须同答案，只改非属主那条会变成「别人的作品→404、不存在→204」，反把存在性泄露出去）。`POST/DELETE /stories/:id/like` 点赞与取消（`AuthRequired`，两条都幂等，返回 `{liked, like_count}`；可见性同 `GET`，别人的草稿一律 404）。**节点 CRUD 已整组下线**，见 §9.2 |
| 游玩（全组 AuthRequired） | `POST /play/sessions`（建空会话）、`POST /play/sessions/:id/opening/stream`（SSE 流式开局，幂等）、`GET /play/sessions`、`GET/DELETE /play/sessions/:id`、`POST /play/sessions/:id/choice/stream`（SSE 流式续写）、`POST /play/sessions/:id/backtrack`（**所有按 sessionID 访问的接口均校验 `session.PlayerID` 归属**） |
| 图片上传（AuthRequired） | `POST /uploads/image`（multipart：`file` + `kind`∈{avatar,cover}，返回 `{url}`）；静态直出 `GET /uploads/*`（见 §14） |
| `POST /assist/world`、`/opening`、`/polish`、`/branches` | 创作辅助；**经 Go `/api/v1/assist/*` 转发**给创作编辑器消费（agent 无鉴权/CORS，前端不直连；Go 侧用 180s `assistClient`）。四个成功响应均回传已知 `usage` 供 Go 统一计费 |
| BYOK（AuthRequired） | `GET/POST /llm/connections`、`PUT/DELETE /llm/connections/:id`、`POST /llm/connections/test`、`POST /llm/connections/models`（用表单现填的 key 拉模型，连接尚未保存时用）、`GET /llm/connections/:id/models`（用存量 key 重拉）、`GET/PUT /llm/story-config/:storyId`（玩家在某作品的模型配置）、`GET/PUT /llm/assist-config`（创作辅助模型，账号级） |
| 平台设置（AuthRequired + `RequirePermission(authz.PermPlatformLLMManage)`，`RequireAdmin` 为其别名） | `GET/PUT /admin/llm/platform`、`POST /admin/llm/platform/test` |
| 社区（未实现） | 路由**未注册**，一律 404。空壳曾返 `success:true`，调用方会误判点赞/评论成功 |

游玩全组 `AuthRequired`，匿名游玩与 `POST /play/sessions/migrate` 已一并移除（原因见 §9.2）。前端 `api.ts` 每请求带 `Authorization: Bearer`（token 存 localStorage）。

### 7.2 Agent 服务

| 接口 | 作用 |
|---|---|
| `POST /generate/stream` `POST /continue/stream` | 流式生成：SSE `delta`/`revise`/`done`/`error` 帧（`done` 携带完整 AIResult） |
| `POST /opening/complete` | 为已写定的开场正文补起始选项 + summary（预设 opening_content 的作品） |
| `POST /merge-check` | 在 Go 的 `state_delta` 硬过滤之后判断同层候选是否语义等价。**必须带 `llm` 下发**（Go 侧 `judgeCfg`：优先审校档，未开审校退到写作档）——agent 无默认凭据，缺了每次 502 |
| `POST /assist/world`、`/opening`、`/polish`、`/branches` | 创作辅助；**经 Go `/api/v1/assist/*` 转发**给创作编辑器消费（agent 无鉴权/CORS，前端不直连；Go 侧用 180s `assistClient`） |
| `POST /assist/validate-key` | 校验某 LLM key 是否可用（一次性 ping，**独立于 `_build_llm` 缓存与生成管线**，不落库）；经 Go 的 `/llm/connections/test`、`/admin/llm/platform/test` 复用 |
| `GET /health` | 检查模型配置状态 |

**BYOK（LLMConfig 下发）**：`/generate/stream`、`/continue/stream`、`/opening/complete` 及 `/assist/*` 请求体可携带 `llm_write`/`llm_review`（play）或 `llm`（assist 单次），字段 `{provider,base_url,api_key,model}`。Go 侧按环节解密解析后下发；agent 用它构造**临时** `ChatOpenAI`（`_build_ephemeral`，不进全局缓存），缺字段/未下发即报错，绝不回退 agent `.env`。写手用 `llm_write`、审校用 `llm_review`。**agent 不碰数据库**，所有 key/策略在 Go。

**深度润色契约**：`POST /assist/polish` 请求固定为 `{text, instruction?, world:{style, style_profile?}, connection_id?}`，不接受顶层 `style_profile`。`style_profile` 缺省兼容旧作品，字段为 `narrative_distance`（`close|medium|distant`）、`rhythm`（`mixed|tight|relaxed`）、最多 3 条 `sensory_focus`、可选 `dialogue_rule`、最多 5 条 `avoid`；Go 发布/草稿校验与 Agent schema 均严格校验其存在时的形状。响应为 `{text, applied, feedback, usage}`，`feedback` 最多两条 `{category,span_hint,goal}`。它是非流式独立闭环：初审 → 至多一次润色 → 复审；仅复审至少提升 5 分、无 major、无锚点丢失且候选格式/长度有效时 `applied=true`，否则 `text` 逐字为原文、`applied=false`。该链路不调用 `story_graph`，不影响玩家 SSE、首字体验或 Hard Review；编辑器仅预览，作者显式采纳才替换。

Agent 的开场和续写响应统一包含：`content`、`options`、`state_delta`、`summary`、`is_ending`、`ending_type`。详见 [`../agent/README.md`](../agent/README.md)。

## 8. 本地运行、测试与真实验收

### 8.1 配置

| 进程 | 示例文件 | 必要项 |
|---|---|---|
| Agent | `agent/.env.example` | **无必填项**：agent 不持有任何 LLM 凭据，key/端点/模型由 Go 随请求下发 |
| 后端 | `backend/.env.example` | 可达 PostgreSQL、`DB_*`、`JWT_SECRET`、`AGENT_URL`；可选 `UPLOAD_DIR`(默认 `./uploads`)、`UPLOAD_MAX_MB`(默认 5) |
| 前端 | `frontend/.env.local.example` | 可选 `NEXT_PUBLIC_API_BASE` |

推荐执行 `./scripts/dev.ps1`。注意后端必须以 `backend/` 为工作目录运行：模板路径和配置搜索路径依赖该目录。

### 8.2 已有自动验证

**没有 CI，也不打算加**：单人单分支、私有仓库（Actions 免费额度 2000 分钟/月），事后跑的绿灯拦不住任何东西，不值这个额度。下面这几条命令**提交前本地跑**就是全部门禁。

```powershell
cd backend
go build ./...; go vet ./...; go test -race ./...

cd ..\frontend
npm.cmd run lint        # --max-warnings 0：警告即失败
npm.cmd run typecheck   # tsc --noEmit
npm.cmd run build

cd ..\agent
.\.venv\Scripts\python.exe -m compileall -q app tests
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

ESLint 用 `next/core-web-vitals`，只关了 `@next/next/no-img-element` 一条（项目刻意用原生 `<img>`，理由见 `frontend/.eslintrc.json` 与 `components/ImageUpload.tsx`）。

当前 Python 测试精简为十一个关键回归：`test_stream.py` 覆盖正常流式回合、审校重写、耗尽降级、关闭审校，以及**结构化/审校不阻塞事件循环**（并发两条流水线，串行化就超时；用 `REVIEW_CFG` 才能同时覆盖到两处调用），且在正常路径一并校验 reveal 门控与 usage 归属；`test_llm_parse_retry.py` 覆盖 JSON 重试和无默认凭据；`test_assist_polish.py` 覆盖润色闭环的未触发、采用、复审回退与预调用预算保护。Go 有 `play_merge_test.go`（节点语义合并契约）、`access_test.go` / `ownership_test.go`（可见性与归属）、`player_view_test.go`（玩家可见投影）、`llm_resolver_test.go`（BYOK 解析优先级）、`worldvalidate_test.go`（含 style_profile 发布校验）、`crypto_test.go` / `upload_test.go`、`response_test.go`（`SafeDetail`：只有 `AppError.Message` 能外发，裸 DB 错误换固定文案，`context.Canceled` 不当故障），`play_opening_test.go`（开场并发：AI 只生成一次、只扣一次费、后到者复用而非报错；leader 重读；唯一冲突翻幂等；约束名判定；**leader 中途失败时 follower 拿到错误而不是 panic**），以及 `play_reuse_test.go`（逐字相同的选择不生成不扣费不建节点；`CheckMerge` 必须收到模型连接；语义命中复用既有节点；判定失败仍照常推进）。

**可选的一档**（默认不编译）：`play_opening_integration_test.go` 带 `//go:build integration`，测的是替身测不出来的 Postgres 特性——部分唯一索引真的拒绝第二个根节点、23505 翻成幂等成功、脏库上 `EnsureRootIndex` 必须报错。⚠️ 这是刻意隔离的：现有 `go test -race ./...` 不需要 PostgreSQL 就能跑，一刀切加 PG 集成测试会让没装 PG 的人连 `go test ./...` 都过不了。

```powershell
Push-Location backend
# ⚠️ 只能指向可随意清空的隔离测试库：会建/删索引、制造唯一冲突、改 play_count
$env:TEST_DB_DSN = "<isolated test database DSN>"
go test -tags=integration ./internal/service/ -run 'Opening|RootIndex' -v
Pop-Location
```

它自建自清（`TestMain` 只建连，schema 由用例自己 `AutoMigrate` + `EnsureRootIndex`，数据用 `t.Cleanup` 删干净）；未设 `TEST_DB_DSN` 时整组 skip，同包的纯 Go 用例照常跑。

### 8.3 必做的人工验收

自动测试不能证明叙事好玩。每次修改 Agent 提示、上下文、质量规则或状态合并后，至少要：

1. 运行真实 Agent、后端和前端；
2. 连续游玩多回合，**专挑矛盾/高风险选项**，并回溯后开新分支、走深剧情；
3. 检查属性显示、状态变化、节点树、读档是否一致；
4. 检查摘要是否遗漏/篡改伏笔和人物关系；
5. 记录审校重写次数与耗时，避免质量循环把体验拖垮；
6. **验揭示门控**：开局属性栏不显示 `reveal` 属性（如《最后的深夜电台》物资/幸存者信任）→ 剧情"清点/首次接触"时才出现且数值合理（不再 5→4）→ **回溯到揭示前又消失**。

### 8.4 真机验收操作手册（起进程 + 留埋点 + 分析）

真人多回合验收的门槛很低。要**留存质量埋点**，关键是让 Agent 的 `story.metrics` 输出落到文件（`dev.ps1` 各开一窗、日志留不下来，故 Agent 单独起并重定向）：

```powershell
# 窗口A · Agent（*> 收下 stderr 上的 story.metrics 埋点到 agent.log）
cd agent
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8001 *> agent.log

# 窗口B · 后端
cd backend; go run .

# 窗口C · 前端
cd frontend; npm.cmd run dev        # http://localhost:3000（PowerShell 下用 .cmd，裸 npm 受执行策略限制）
```

玩够量后**离线聚合埋点**：

```powershell
cd agent
.\.venv\Scripts\python.exe tools\aggregate_log.py agent.log
```

输出：首稿通过率 / 降级率 / 审校拒绝率 / **拒因按频次分布** / 完整延迟与 ttfb 的均值·p95 / 按 mode(start,continue) 分解。据此回答"叙事质量与延迟"这类可量化问题（指标含义见 §9.1）。

- **埋点两行**：`gen`（`outcome/elapsed_ms/ttfb_ms/review_failures/first_draft_pass/degraded/is_ending`）与 `review`（`verdict/attempt/issues`），源在 `agent/app/graph/story_graph.py`。
- **别用 `tools/sample_metrics.py` 做验收**：它自动线性采样（永远点第一个选项），触发不了三类高频拒因，只能跑通/看延迟基线（原委见 §9.2）。
- 日志覆盖不了、仍须人眼看的：摘要漂移、人物/伏笔矛盾、选择无后果、揭示/回溯一致性、阅读手感与延迟忍受度（即 §8.3 第 2/4/6 项）。

## 9. 当前风险、技术债与优先级

### 9.1 最高优先级：先量化游玩留存体验

下一位开发者不要直接上社区或支付，应先跑真实多回合样本并记录指标。

**已就绪的埋点**（`agent/app/graph/story_graph.py`）：

- **每次生成流一行 `gen`**（`_invoke_with_metrics`）：`mode`、`outcome`、`elapsed_ms`(完整回复耗时)、成功时附 `review_failures`(交付前被拒次数，0=首稿通过)/`first_draft_pass`/**`degraded`(是否超限降级交付)**/`is_ending`，失败时附 `err_type`/`detail`。`outcome`：`ok`(含降级交付) / `parse_error`(LLM 非法 JSON，`LLMParseError`) / `error`(其它)。审校超限**不再是失败**（不再有 `review_exhausted`）——它以 `outcome=ok degraded=1` 交付，另有一条 `review degraded ...` WARNING 记录被拒次数与理由。
- **每次审校判定一行 `review`**（`review` 节点）：`verdict`(pass/reject)、`attempt`、拒绝时附 `issues`。用来回答「审校到底在拒什么、是不是形同橡皮图章」，这是 `gen` 行的通过率无法单独回答的。

刻意不建管理端大屏/指标表——验证期用日志聚合即可。两个工具分工：

- `agent/tools/sample_metrics.py`：**自动线性采样**，进程内直驱 `run_start/run_continue` 现造数据（会调 DeepSeek）。只能刷漂亮数字、**触发不了三大拒因**（见 §9.2），对提示词质量改动无区分力，仅用于跑通/延迟基线。要逐回合人工检查一部已发布 AI 开局作品的正文、摘要、选项、状态、SSE `revise`、首字时间与 usage，则用 `agent/tools/playtest.py --write-config-file C:/secure/write.json [--review-config-file C:/secure/review.json]`；`--write-config-file` 同时供 Writer 和 Structurer 使用，输出 `write` usage 是两阶段累计，`review` usage 仅来自 Reviewer。它不读取默认凭据、不替 Go 解析连接或记账；省略 review 配置只关闭审校，结构化生成仍会执行。
- `agent/tools/aggregate_log.py`：**零依赖离线聚合器**，只读**真人真实游玩**产生的 agent 日志，不碰 app/DB/LLM。这才是给提示词质量“结账”的正道——真人的矛盾选择/回溯/深剧情才会让三大拒因真正发作。用法：真人游玩时把 agent 进程输出重定向到文件（`uvicorn app.main:app --port 8001 > agent.log 2>&1`），玩够量后 `./.venv/Scripts/python.exe tools/aggregate_log.py agent.log`，直接出报表（首稿通过率/降级率/审校拒绝率/**拒因按频次分布**/延迟与 ttfb p95/按 mode 分解）。

等社区上线、指标从"验证一次"变成"每天要看"且鉴权就绪后再考虑大屏。

由此可直接算出：

- 首稿审校通过率(`first_draft_pass=True` 占比)、每局平均重写次数(`review_failures` 均值)、审校拒绝率(`review` 行 reject 占比)；
- 完整回复延迟与 p95(`elapsed_ms`)；流式续写另打 `stream=1` 与 **`ttfb_ms`（首字延迟）**——实测约 1.5s（vs 完整 ~7.7s）。注意 `app/main.py` 已给 `story.metrics` 挂 handler，否则 uvicorn 默认吞掉 INFO 埋点；
- 降级交付占比(`degraded=True` 占比，反映审校拖到超限的频率)；真报错率按 `parse_error` / `error` 细分。

仍需人工观察、日志无法覆盖的：

- 摘要漂移、人物/伏笔矛盾、选择无后果等案例；
- 回溯后分支的状态与叙事一致性。

### 9.2 已知技术债

**`style_profile` 是一个没有写入方的字段**
- `pkg/worldvalidate.go` 对它有六条发布校验（叙事距离/节奏/感官侧重/规避项/对白规则），`agent_client` 也会把它透传给润色管线——但**产品里没有任何地方写它**：编辑器无输入控件，`/assist/world` 的 `WorldDraft` 也不含该字段（`style_profile` 挂在 `WorldConfigObj` 上，两者别搞混）。它只会来自直接写库/直调 API 或存量数据。
- 后果：对编辑器建出来的作品，这几条校验恒为 nil、恒通过，属防御性校验。真触发时作者在界面上找不到那一栏，**且「重新生成世界观」不管用**（重生成根本不产出该字段）；管用的出路是让它过一遍 `editorStore.serializeStyleProfile`——重新打开作品保存一次即自动规范化，错误文案已按此指引。
- 要真正补齐，得在段 2 加一组控件（或只读展示）并让 `/assist/world` 产出它；在那之前这是一条「有校验、有消费方、无生产方」的悬空链路。

**质量审校（review）**
- review 是同一模型的二次调用：能抬下限，不保证事实正确，且加延迟与费用。真实样本拒绝率约 18%，**不是橡皮图章**。两类主要拒因：`state_delta` 与正文不一致、`summary` 漏记新增实体。（第三类「选项 hint 无后果」已随 hint 移除而作废。）
- 已针对拒因把 `prompts.py` 的散文规则换成**可自检的动作锚点**（写 JSON 尾前回看正文倒推 delta/summary；落笔前自检本段新登场人物/物品/线索），而不是堆更多规则。
- ⚠️ **玩家多回合的提示词质量不能靠离线 A/B 结账。** 线性采样（`agent/tools/sample_metrics.py`）、逆境 A/B（`agent/tools/adversarial_ab.py`，新旧提示词喂完全相同的玩家输入）、直接审计转录，三种手段都跑出「新旧完全一致」——因为逆境压的是剧情黑暗度，而拒因是**输出纪律**问题（长上下文摘要漂移、真正模棱两可的状态变化、模型方差），选择文本逼不出来。**唯一能结账的是真人多回合埋点**（`gen`/`review` logfmt 已就位，见 §9.1），攒到几百回合再统计 `first_draft_pass`/`reject_rate`/拒因分布。这个结论不适用于作者侧独立单段润色：`agent/tools/style_polish_ab.py` 对 8 个原创夹具每个运行 3 次，生成 24 个随机 A/B 盲选对；人工按自然度、人物声音、具体性、节奏强制二选一，并核验 anchors。验收门槛为 Candidate 至少胜 15/24 且零锚点丢失；输出与 mapping 写入已忽略的 `agent/tools/out/`。
- 想要更灵敏的离线仪表，得换成对 delta 完整性/实体召回打分的**分级 LLM 裁判**，而非 review 的二元闸门——pre-launch 不值当。
- **选项 hint 已整体移除**：真机试玩发现「收益+转折+风险」两面结构太标准化，且每次提前剧透后果、破坏悬念。属性变化预估也被否（反事实预测常与真实 delta 不符、更游戏化、隐藏属性还不能显示）。选项回归**纯行动文字**，代价交给玩家在剧情里承受；`normalize` 主动剥离 hint 兜底。
- 待查：采样时 openai SDK 层几乎每次调用都有一次 `Retrying request`，疑似 DeepSeek 限流，可能抬高了 `elapsed_ms`。

**其余**
- LLM 偶发返回非法 JSON（真实样本约 7%）。`chat_json` 对 `LLMParseError` 附纠正指令重试 `AI_PARSE_MAX_RETRIES`（默认 1）次并打 `parse_retry` 点；耗尽仍抛。
- `summary` 是有损压缩，长剧情仍会漂移；RAG 是后续补精确细节的方案。
- **匿名 guest 共享 PlayerID 已彻底移除（2026-08-11）**：曾经所有匿名玩家共用同一个 seed `guest` id，`checkSessionOwner` 因此对匿名会话之间完全失效（彼此可读可删）。现 `/play` 全组 `AuthRequired`，`player()` 的 guest 回退、`/play/sessions/migrate`、`MigrateGuestSessions` 一并删除。**取舍**：历史 guest 存档留在库里但不可达、不提供迁移——这是为消除已确认越权面所付的明确代价。那个 `guest` 账号如今只是老库里的一行历史数据（现有演示作品挂在它名下）；seed 已于 2026-08-12 整个删除，新库不会再有它。
- **创作侧 node CRUD 已整组下线（2026-08-11）**：`POST /stories/:id/nodes`、`GET /nodes/:id/children`、`PUT/DELETE /nodes/:id` 连同 `NodeHandler`/`NodeService` 一起删除。原因是它以 `sessionID=uuid.Nil` 写非空列、且创建路径不校验作者，只摘一半会留下「作者去改玩家会话节点」这种更怪的语义。`StoryNode` 模型与 repository 保留，专供游玩链路。将来要做可视化作者树，必须新建 `DraftNode` 或明确可空 session 的模型，不能复用游玩节点。
- **上传孤儿文件无回收（2026-08-10）**：上传成功但表单没保存、换头像/封面后的旧文件，都会永远留在磁盘。最小治理方案是「上传即写一行 assets 表 + 夜间扫描无引用记录」，0 用户阶段不值得。
- **上传走单机本地磁盘（2026-08-10）**：`UPLOAD_DIR` 是进程本地目录，多实例必须挂共享卷（compose 已挂 named volume `uploads`）。换对象存储只需替换 `service.UploadService`，`url` 语义不变、无需迁移表。
- **平台额度的单价要 admin 手工维护（2026-08-10）**：`platform_llm_settings.price_*` 默认 0，**不填就永远扣不动额度**（安全的失败方向，但等于无限免费）。模型涨价也不会自动跟。
- **事后扣费允许最后一回合透支（2026-08-10）**：花多少 token 只有调用完才知道，因此扣到 0 为止、不预扣。真要精确就得先估上限再冻结，0 用户阶段不值当。
- **匿名玩家无法游玩（2026-08-10，产品取舍不是 bug）**：额度挂账号、平台档对匿名不给，所以未登录只能浏览，点进详情页会被拦并引导登录（「登录即赠 1 元」）。2026-08-11 起后端也不再接受匿名游玩请求，前后端一致。
- **草稿只有作者可读可玩（2026-08-11）**：`service.canViewStory`/`canPlay`（`internal/service/access.go`，纯函数、有单测）统一判定，非作者一律 404 不返 403（草稿的存在本身是作者的私事）。
- **作品下架后既有会话转只读（2026-08-11）**：作者取消发布，别人玩到一半的那一局**可以读完，但不能再推进**——这是「引用模式」的下架语义（PRD §5.4.8）。`PlayService.storyGate` 返回 `playable`，`GetSession` 据此置 `SessionResult.read_only`；写路径（续写 / 开场生成 / 回溯）一律被 `readOnlyErr` 拒绝，文案明确、不用 404：玩家早就玩过这部作品，藏它没有意义。**注意 SSE 路由的状态码仍是 200** —— `sseStart` 在调 service 前就提交了响应头，所以续写/开场是以 `event: error` 帧送出该文案（本项目所有流式错误都如此，前端读 `detail`）。⚠️ `detail` 一律经 `pkg.SafeDetail`：只有 `AppError.Message`（我们写给用户看的话）会外发，裸 GORM/pgx 错误记服务端日志后回固定文案，`context.Canceled`（玩家关页面）短路不记；只有 `backtrack` 这类普通 JSON 路由才真的返 403。读档列表的 `available=false` 是同一含义，卡片仍可点，状态照常脱敏后外发。
- **玩家可见数据投影已完成（2026-08-11）**：`hidden` 属性与未揭示的 `reveal` 属性，其数值不再出现在任何游玩接口的 `current_state`/`state_snapshot`/`state_delta` 里（`service/player_view.go` 的 `attrView`）。节点按**自身** `revealed_snapshot` 过滤，所以时间线不会提前剧透、回溯到发现之前会重新隐藏；会话按 `revealed_attrs`。作者玩自己的作品不脱敏。读档列表取不到作品时整份状态置空（宁可多挡）。
- 社区路由**未注册**（2026-08-11），访问一律 404。此前空壳 handler 返 `success:true`，会让调用方误判操作成功。
- **开场并发有三层保护，各管各的（2026-08-21）**：① **进程内单飞**（`PlayService.flights sync.Map`，key 是 `sessionID`）——唯一能省掉重复生成与重复扣费的一层；leader 身份取 `LoadOrStore` 的第二个返回值（**不是 `singleflight.Shared`**，那个对所有调用方都为 true，照它判会让 leader 把正文播两遍），抢到之后**先重读会话**再决定生不生成，收尾三步「填结果 → `Delete` → `close`」且 `Delete` 必须在事务提交之后，`defer` 带 recover（leader panic 而没 close 会让 follower 永久挂起）；**`finish` 兜底断言「要么填了结果、要么填了 `err`」**，否则统一置 `Internal`——leader 的某条 return 忘写 `fl.err` 时，follower 会把失败当成功、转身去读 `fl.root.Content`（nil）而 panic，漏写只是少一行，所以这条不变量落在唯一的收尾处而不是指望每个分支都记得；follower 不接自己的 `onDelta` 进共享工作，拿到结果用 `streamFixedText` 回放。② **部分唯一索引** `uniq_root_per_session`（`repository.RootIdxName`，`NodeRepository.EnsureRootIndex` 建，`main.go` 在 `AutoMigrate` 之后调、失败即 `log.Fatalf`）——跨实例、跨重启的兜底；撞上它翻成**幂等成功**（`adoptExistingOpening`）而不是 500。⚠️ 判定必须**连约束名一起判**，只看 SQLSTATE 23505 会把将来任何一条唯一冲突都吞成「根节点已存在」，把真实错误埋掉；也不能用 `gorm.ErrDuplicatedKey`——`main.go` 的 `gorm.Open` 没开 `TranslateError`，那个哨兵永远不会产生。③ **阅读量自增**放在事务提交之后，经 `StoryCounter` 窄接口走 SQL 表达式（`play_count = play_count + 1`，不读改写），失败只记日志不上抛——计数绝不能弄砸玩家这一回合。**⚠️ ② 挡不住那个请求已经花掉的生成与扣费，那是 ① 的职责，而 ① 只在单实例内有效**；多实例化时换成数据库层认领（给 `play_sessions` 加 `opening_claimed_at` + TTL）。
- **`play_count` 的口径是「产生过开场」，不是「建过会话」**：计数点在 `StartOpeningStream` 根节点落库成功之后，`POST /play/sessions` 只插一行空会话不算。用计数器而非 `COUNT(play_sessions)` 派生：删存档不该抹掉「读过」这件事。老会话不追认，一次性手工回填（**别写进启动流程**，`seed()` 正是因为在生产库上跑启动期夹具代码才被整个删掉）：`UPDATE stories s SET play_count = (SELECT COUNT(*) FROM play_sessions WHERE story_id = s.id AND current_node_id IS NOT NULL);`
- **本轮审核发现、刻意未修的四项（2026-08-25）**：① `LLMService.fetchModels` / `TestConnection` 用完全由用户填的 `base_url` 发请求、且回显连接错误原文 —— BYOK 天然需要这个能力，加内网地址段拦截会一并挡掉本地自建端点（127.0.0.1、局域网 Ollama），得配一个放行开关才动。② 前端 `StoryLLMConfigPanel` / `AssistModelSettings` 的 orphan 判定写成 `!!bound && ...`，连接被**删除**时 `bound` 为 undefined、判不出孤儿，下拉静默显示成「平台预设」而草稿里那条死绑定还在，保存才吃 400。③ `PlayService.Backtrack` 无条件 `session.Status = "active"`，回溯到结局节点会让那一局重新可推进。④ `runOpening` 里 `story == nil`（作品被硬删）走的是 `readOnlyErr()`，把「作品不存在」说成「已取消发布」。⑤ **删作品不级联删 `user_story_llm_configs`**（真机验收时发现：作品与会话都删干净后，那张表仍留着一行该作品的模型绑定）——与「上传孤儿文件无回收」同一类数据卫生问题，孤儿行不影响任何读路径（解析时连不上作品就走不到），0 用户阶段不值得治。
- **`runOpening` 的 leader 重读分支零测试覆盖**：`TestStartOpeningStream_LeaderRereadsSessionBeforeGenerating` 名不副实——它在调用前就 `setRoot`，走的是 `StartOpeningStream` 开头那条**前置幂等**分支，根本没进 `runOpening`。真正的 leader 重读（抢到 flight 后再查一次会话）要让根节点在两次 `sessions.FindByID` 之间出现才测得到。
- `AutoMigrate` 适合当前 demo，不等同于生产级迁移治理。
- Go 侧的 context 透传、优雅关闭等工程化问题记在 [prd.md](prd.md) 开放问题里（seed 开关已不再是问题：整个 seed 于 2026-08-12 删除）。

### 9.3 建议的后续顺序

1. **试玩与观测**：跑真实多回合样本，攒够量后用 `tools/aggregate_log.py` 结账（埋点已就位，见 §9.1）。这仍是第一优先级——提示词质量只有真人多回合能量出来。
2. ~~**创作前端**：消费 `/assist/*`，打通"创作 → 游玩"~~ ✅ 已完成(MVP)。剩余打磨是 `/assist/branches` 编辑内接入。
3. ~~**前端重构**：万象设计体系落地~~ ✅ 已完成（14 条路由，见 §13）。剩余是**真机走查**：`/mine` 有作品时的作者天空、`/mine/history` 有存档时的行版式两处版式仍未用真数据验过（探针账号既无作品也无存档）。
4. **Agent 阶段二**（**因备案冻结真机验证而暂缓**，待线上恢复后带真实数据做）：依据数据选择先拆 director、先补 recall/RAG；不要一次完成完整多 Agent。
5. **社区 MVP**：评论、收藏、关注（点赞已落地）；随后才考虑付费与成就。⚠️ 衍生分叉（`derivation-graph`）需要 fork 模型 + 分支归属 + 分支计数，是独立于社区 MVP 的一整块，见 §13。

## 10. 文档维护规则

| 文档 | 应记录什么 | 何时更新 |
|---|---|---|
| `README.md` | 项目入口、架构、当前概览、快速启动 | 主链路/入口/优先级变化 |
| 本手册 | 现状、边界、文件入口、交接风险、验证方式 | 任一模块状态或契约变化 |
| `CLAUDE.md` | 开发规范、分层边界、实现约定、**不放进度状态** | 修改工程规则或运行方式 |
| 模块 README | 模块接口、配置、目录、测试 | 修改模块契约/流程/配置 |
| `docs/design.md` | 技术选择、演进和权衡 | 修改架构/数据/Agent 方案 |
| `docs/prd.md` | 产品愿景、范围、开放决策 | 修改产品目标或优先级 |
| `infa/sql/` | 完整数据模型设计 | 新增持久化模块或改变长期 schema |

**完成代码任务不等于完成交付。** 涉及当前行为、配置、接口、数据字段或优先级的改动，至少更新本手册和对应模块 README；必要时同步设计文档与 `CLAUDE.md`。

**怎么写**见 `CLAUDE.md` 的「Keep docs small」——一句话版本：改受影响的那几行，不要另起一节；一个事实只存一处，别处只放指针；git 是变更日志，文档不是。

## 11. 接手第一天检查清单

- [ ] 先阅读本手册、`CLAUDE.md` 和目标模块 README。
- [ ] 查看 `git status`，区分前人未提交改动与本次改动，不覆盖未知修改。
- [ ] 复制三份示例环境文件，确认 PostgreSQL 和 DeepSeek 配置。
- [ ] 跑 Go 测试与 Agent 离线测试。
- [ ] 用 `scripts/dev.ps1` 启动三进程，完成一次开局、续写、回溯、读档的人工冒烟。
- [ ] 开始新功能前，先确认它属于“当前游玩留存优先级”还是未来愿景，避免跳过关键验证。

## 12. BYOK 多供应商 / 分环节模型 / 平台设置 / admin 门槛

**目标**：支持任意 OpenAI 兼容 key；平台 key 入库由管理员管理；游玩优先烧**玩家自己**的 key，未配则从**注册赠送的 1 元额度**里按量扣平台 key，额度用尽必须自带连接。
**分层**：连接（key/base_url）是**用户级**（账号里管一次）；游玩侧「用哪个模型」是**作品级**（每玩家在每作品各配各的）；创作辅助（world）是**账号级**（设置页配一次，所有作品通用——第一步「AI 生成世界观」时作品还不存在，没有 story_id 可挂）。作者的推荐模型只作标注、不自动套用（作者与玩家配置大概率不同，复刻也用不了）。

**数据模型**
- `llm_connections`（每用户多条）：`name(备注) / provider(标签) / base_url / api_key_cipher(AES-GCM) / models`。`models` 是 TEXT/JSON 数组，用户填完 key 后由 `POST /llm/connections/models` 拿这套凭据去端点 `/models` 拉取、勾选入库（端点不实现 `/models` 时可手填）。**没有「默认模型」**：旧的 `default_model` 列已废弃留作孤儿，启动时 `DROP NOT NULL` + 一次性回填进 `models`。
- `user_assist_llm_configs`（主键 user_id，每用户一行）：`conn_id UUID NULL / model`。创作辅助用哪条连接的哪个模型；`conn_id` 空=走平台 world 档。
- `user_story_llm_configs`（复合主键 user_id+story_id）：`bindings` TEXT/JSON = `{"write":{"conn":"<uuid>","model":""},"review":{...}}`；**`conn` 非空时 `model` 必填**（连接无默认模型可回退，空 model 视为该档未配置、回落平台）。仅 write/review。另有 `review_enabled BOOL`（**默认 false**，见下）。
- `platform_llm_settings`（全局，admin 管，每环节一行）：`stage PK / provider / base_url / api_key_cipher / model / price_in_per_mtok / price_out_per_mtok`。单价单位是**元 / 百万 token**（照抄供应商定价页）。⚠️ **单价为 0 则永远扣不动额度**，等于平台 key 无限免费——admin 页对此显式告警。
- `users.credit_micro_cny BIGINT DEFAULT 1000000`：平台额度余额，单位**微元**（1e-6 元）。整数避免浮点累加误差；列默认值 = 1 元，注册即到账（AutoMigrate 加列时 Postgres 也会给存量行补上）。
- `llm_usage_logs`：每笔**平台额度**消费的流水（user/story/stage/model/tokens/cost_micro/estimated）。玩家用自己的 key 不入账。没这张表，"我那 1 元花哪了"只能靠猜。
- 作者推荐模型：`stories.world_config.recommended_models = {"write":{"model":"..."},"review":{...}}`（前端编辑器写、作品详情页只读展示；后端透传，不参与解析）。
- 旧 `User.LLMKeyCipher`（单 key）**废弃**，列留孤儿（GORM 不删列，0 用户未迁移）。

**解析优先级**（`service.LLMResolver`，单测见 `llm_resolver_test.go`）：
- 游玩（`ResolveForPlay(userID, storyID, stage)`，stage∈{write,review}）：**作品级用户连接 → 平台档（需有额度）→ nil**。
- 创作（`ResolveForAssist(userID)`）：**账号级创作辅助配置 → 平台 world（需有额度）→ nil**。配置读自 `user_assist_llm_configs`，**不由请求体携带**——客户端指不定用哪条连接。
- 命中连接/平台时解密 key；连接失效/解密失败**跳到下一档**不硬报错。
- **返回 nil 就是硬失败**（`pkg.CodeNoLLMConfig` = 10016），调用方必须在发请求前报错。曾经的第三档「agent 自己 `.env` 的 `DEEPSEEK_API_KEY`」**已删除**——那是一层看不见、无法限额、也不归 admin 管的服务器成本。`TestPlatformNeedsCredit` 守着这条别被加回来。
- 平台档对**匿名一律不给**：额度挂账号。这一档如今是防御性的——`/play/*` 全组 `AuthRequired`，匿名请求到不了解析这一步；历史上所有匿名玩家共用同一个 `guest` id（§9.2），给了等于让第一个访客花光所有人的额度。

**额度与扣费**（`service/credit.go`）
- 只对 `AgentLLMConfig.Source == platform` 的环节扣（该字段 `json:"-"`，不下发给 agent——agent 不该知道钱的事）。
- agent 在 `done` 帧回传按环节分开的 token 用量；Go 按该环节单价折算成微元、**向上取整**（几百 token 的调用四舍五入会常年归零，1 元就成了无限），写一行流水并 `UPDATE ... GREATEST(0, credit - ?)`。扣减在 SQL 里做，避免并发回合先读后写吞掉一次消费。四个成功的创作辅助响应也按已知实际 usage 事后记账：`assist_world`、`assist_opening`、`assist_polish`、`assist_branches`，流水 `StoryID` 为空；BYOK 跳过平台扣费和平台 usage。深度润色回退仍会对已经完成的模型调用照实扣费，网络/模型失败拿不到 usage 时不虚构扣费。
- **事后扣费**：花多少 token 只有调用完才知道，事前无法预扣准确金额，因此**最后一回合可能略微透支**（扣到 0 为止）。用一套精确预扣换这点误差，0 用户阶段不值当。
- 扣费失败只记日志、不向上报错：token 已经烧掉了，此时让玩家的回合失败于事无补。
- `estimated=true` 表示端点没在响应里回 usage、token 数是**按字符估算**的（OpenAI 兼容端点对 `stream_options.include_usage` 支持不一）。这批为真时说明扣费全靠估算——是需要知道的事实，别被精确数字掩盖。

**review（质量审校）改为作品级开关，默认关**
- 关：不下发 `llm_review`，agent 整段跳过审校（省约一半 token），埋点打 `review=off`，不伪装成 `first_draft_pass=true`。
- 开：`review` 环节**必须解析得出配置**——绑一条自己的连接，或平台档该环节可用（`platform_llm_settings` 每环节一行，review 那行同样能配 key）；两者都没有则保存被拒（不静默降级成"关掉"——那会让玩家以为审校在生效）。
- 默认关的代价：质量下限低于以前（以前人人都过审校，真实拒绝率约 18%）。权衡写在前端开关旁。

**下发链路**：Go 解析出 `AgentLLMConfig{provider,base_url,api_key,model}` → 塞进 agent 请求体（`llm_write`/`llm_review`/`llm`）→ agent `_build_ephemeral` 构造临时 ChatOpenAI。**agent 不碰库、也不持有任何默认凭据**：三个关键字段缺一即抛 `LLMConfigMissing`。key/额度/策略全在 Go。

**admin 门槛（最小）**：JWT 携带 `role` 快照（`pkg.GenerateToken(userID, role, secret)`）；`middleware.RequireAdmin()` 校验；`/admin/llm/*` 挂 `AuthRequired+RequireAdmin`。
- **产生第一个 admin**：手动改库 `UPDATE users SET role='admin' WHERE username='<你的用户名>';`，然后该用户**重新登录**（role 是 JWT 签发时快照，旧 token 不含新角色）。前端 `/admin` 与 `/mine/settings` 的「平台设置」入口按 `user.role==='admin'` 显示；后端才是硬防线。

## 13. 万象设计体系（深空 + 每作品一个色相）

**深空墨底 + 纯黑剪影 + CSS/SVG 生成的天空**，每部作品一个 `--hue`(0–360) 驱动整套 `oklch()` 派生色。**没有模式切换这回事**——深色底是「每部作品的颜色能读成光」的物理前提。被它取代的那条旧方向（白底 + 管理态/阅读态双态）存档在 `docs/design/wanxiang-design-brief.md` §1，代码于 P4 删净。

**样式只有两个去处**：`app/globals.css`（全站唯一一份全局表，1081 行）+ 每页/每组件一份 CSS Module。全局表只放三类东西：① token（`:root` 全局 + `.world-scope` 角色 token + `@property --hue`）；② reset、`.sr-only`、减动效；③ 全站共享组件层（背景栈 / 天空 / 剪影 / 顶栏 / 二级导航 / 表单件 / 按钮 / 开关 / 对话框 / Toast + 五个 `wx-` 关键帧）。**token 的真源是 `docs/design/DESIGN.md` §3–§4，全局表是它的实现，不是第二份真源。**

字体：`layout.tsx` 经 `next/font` 注入 Inter(`--font-sans-inter`) + Noto Serif SC(`--font-serif-noto`)，`globals.css` 的 `--font-ui`/`--font-display` 引用它们并接系统回退栈。**两边变量名必须错开**——同名时 `:root` 与 next/font 注入的 class 权重相同(0,1,0)，后加载的 `globals.css` 会覆盖掉真实字体名，webfont 白下载不生效（已踩过一次）。

**作品级主题**存在 `world_config.theme`，**零后端改动**透传（后端固定 struct 忽略未知键）。**存的是值不是 id**：`{hue, figure}`——预设若只是前端常量，改动某个预设的色相会让所有用它的作品一起变色；值固化进作品后，颜色是作品身份的一部分。库里两种形态长期并存（实测 12 部里 7 部是老的字符串预设 id、5 部是对象），`lib/hue.ts` 的 `resolveTheme(worldConfig, storyId)` 三级解析全吃：对象 → 预设查表 → `storyId` 哈希兜底。15 套预设只服务编辑器段 5 的选色器。主题脱离作品获得独立身份是既定路线，架构见 [plan.md](plan.md) 附录 A；那一步加的是身份层不是替换存储层，本轮的读路径一行不作废。

主题**不是换肤而是染色**：一个 `--hue` 驱动 `.world-scope` 上整套 `oklch()` 角色 token（`--w-sky-*`／`--w-line`／`--w-ink`／`--w-plate` 等，L 与 C 写死、只有 H 跟着变）。⚠️ 挂载点必须是**消费它的那个元素**（由 `components/sky/WorldScope.tsx` 负责），放 `:root` 会把所有卡片锁成同一色相。消费者：星系卡、聚焦浮层与详情页（`WorkDetail`，浮层与整页同一份内容契约）、游玩页整页（`playStore.theme` 是 `{hue,figure}`，`load()` 复用已拉的 `/stories/:id`，零额外请求）、我的作品页与历史的缩略天空。

**天空是全站复用最多的图元**，收敛在 `components/sky/`：`Sky`（分层 `sky-grad → halo → cloud → starfield → meteor → horizon → ground-glow → figure`，各页取子集）、`Figure`（六姿态剪影）、`Backdrop`（固定背景栈）、`WorldScope`（挂 `--hue` 的作用域容器）。星点撒布一律走 `lib/prng.ts` 的定种子线性同余，**全站禁 `Math.random()`**——服务端渲染与客户端水合必须产出同一串数。

**顶栏分两态**（`components/wx/WxHeader.tsx` + `AccountMenu.tsx`）：主导航只放三项公共入口（星海 / 作品馆 / 社区），**不随登录态变形**；右侧账户区已登录是头像 → 下拉菜单（我的空间 / 我的作品 / 历史记录 / 消息 / 设置，admin 另有平台设置，末尾退出登录），匿名是「登录 + 注册」。⚠️ 两个入口**永不同屏**——设计稿 §7.6 原写「顶栏不加登录入口」，理由只覆盖登录态，而产品里匿名访客可以浏览已发布作品，照原规格做他会看到一个没有任何登录入口的顶栏。**个人向的新页面一律加进 `AccountMenu` 的 `ITEMS`**，不要往主导航上挂。⚠️ 登录态判定要等 `authStore.hydrated`：服务端与客户端首帧都读不到 localStorage，按 `user===null` 直接画会让已登录的人先闪一下「登录 / 注册」；补水前两态都不渲染，标记一致故无 hydration mismatch。

**入口/展示**：编辑器段 5「主题与天空」= 15 个预设色块 + 自由色相条 + 6 个姿态，`themePicked` 作段 5 的就绪判定（是编辑期足迹，**不进 `world_config`**）。作品卡无封面时渲染纯 CSS 天空——库里 12 部 `cover_url` 全空，**无图态是默认态、不是降级态**。

**不落地的一页**：`docs/design/derivation-graph.html`（衍生星图）**没有路由，也不做占位**。它的前提是跨作者衍生分叉，而无 fork 模型、无分支归属、无 `copied_from`；作者侧 node CRUD 已于 2026-08-11 下线且明令不得复用 `StoryNode`（§9.2）。做一个「开发中」的星图页只会让人以为 `/play` 那个坏了。该原型已重做为 v4「缎带」画法（不画分支，画走过分支的人：支流宽度 = 人数，根占满画布、孩子在父亲宽度内按人数分段，因此**构造上不可能溢出**；标签只在河道够宽时才出现，重叠不可能发生）——⚠️ **这套画法降级不到 `/play` 的世界星图**：单人 session 树里每条支路的「人数」恒为 1，缎带会退化成等宽色带，核心信息量整个消失。它是后端具备 fork 与分支计数之后的目标形态，不是现在可搬的东西。`/play` 星图继续用「节点即星 / 连线即光 / 待揭示虚线环 / 确定性布局」那套，**规模问题由自己那套解决**（`frontend/lib/tree.ts`）：**显示列**走 x、分叉走 y，层距按视口宽在 72–132px 间自适应。一局的形状是长链少分叉，换轴之后纵向恒定一屏尽收，只有长局才横向滚动；主线子节点继承父行，因此根→当前恒是一条笔直的横线。横轴用显示列而非 `depth`，是因为连续的「继续」翻页（AI 没给选项那几回合）会被 `collectRun()` 折成一颗标「继续 ×N」的星：它们不是决策点，各占一列等于用横轴长度表达「翻了几页」。开局、当前所在、结局、真实选择一律不折叠，末节点的分叉照常从折叠星挂出去；点折叠星是展开而非检视——星图兼着回溯入口，直接吞掉会让玩家没法回到翻页途中用自由输入岔出去。

**边界（不做）**：玩家全局覆盖皮肤推迟。（`--reader-bg` 那个自主背景图替换点已随旧层删除；作品封面走的是 `cover_url`，见 §14。）

### 13.1 沉淀下来的硬约束

只留仍然生效、且踩过坑才知道的约束。

**布局与卡片**
- 书库作品墙是**等大网格**（`grid` + `repeat(auto-fill, minmax(260px,1fr))`），不是 `column-count` 瀑布——多列是竖向填充，阅读顺序会变成「第 1 列从上到下再第 2 列」，且 6 张卡会排成左重右轻。
- 卡片等大靠：封面 `min-height: 210px` + 列向 flex，标题钳 2 行、摘要钳 3 行，CTA 用 `margin-top: auto` 顶到封面底部（标题长短不一时 CTA 仍在同一水平线）。**骨架卡必须同步等高**，否则加载态到落地会跳动。
- 题材角标用 `tags[0]`，**不是主题**——`theme` 只决定配色，拿它当题材会让《孤岛探案》标成「恐怖 · 怪谈」。`/works` 的题材筛选从**实际在架作品**的 `tags[0]` 派生，缺 `tags` 的那部要有兜底、不能渲染成空白角标。
- 窄屏（≤1080px）**不隐藏属性轨**：属性是「选哪一项」的依据，藏了就没法决策。左轨改成正文上方可横滑的状态带，右轨收起。

**组件**
- **新组件必须在同一阶段就有真实消费者**，只建不接等于新造死代码。
- `Dialog` 必须 **portal 到 `body`**：留在原组件树会被祖先的 transform / overflow / z-index 裁掉或压住。⚠️ 代价是它落在**任何页面容器之外**，所以它用到的 token 必须是全局的——迁移期 token 曾挂在页面根元素上，那阵子 BYOK 弹层一直取不到、掉回浅色。配套：焦点陷阱 + 焦点归还、Esc 关闭、滚动锁定。弹窗打开时错误提示要按开合分流，否则被遮罩挡住、用户只看到「保存」毫无反应。
- **轻量破坏性动作用行内二次确认，不弹窗**（删作品/删连接是点两下）。
- Toast 统一走 `useToast()`（统一时长、连续提示重新计时、卸载清 timer）。
- **`components/editor/PublishCheck.tsx` 镜像 `pkg/worldvalidate.go` 的 strict 分支** —— ⚠️ 改后端 strict 规则必须同步改它，否则前端放行、后端拒。
- 编辑器是**分步向导**（六步，同一时刻只渲染当前步），不是长表单：世界观那一段字段密集（标题/简介/背景/风格/题材/基调/规则/大纲/角色），和开场、属性表堆一页里作者不知道下一步干什么。完成态只由发布检查有检查项的步骤驱动——没有检查项的步骤不打勾，否则误导成「这步做完了」。
- 阅读偏好只剩两项，都在 `lib/readerPrefs.ts`：**减少动效**（写 `<html data-motion="off">`，`PrefsBoot` 每次加载套回）与**遮罩浓度**（游玩页与设置页共用同一个键，夹在 52–92 的百分比整数）。⚠️ 遮罩只写 localStorage、**不写 `<html>` 上的自定义属性**——它是某一页局部的效果（游玩页根元素上的 `--reader-veil`），挂到 `<html>` 会漏到每一页。氛围场景与昼/夜切换随旧体系一并删除。

**token 合规的复查口径**（回归时照这四条量，前三条可脚本化）
- **任何 `.css` 里零 hex**：`rg -n '#[0-9a-fA-F]{3,6}' frontend/app frontend/components -g '*.css'` 应无输出。派生色一律 `oklch()`——hex 表达不了「L/C 写死、只有 H 跟 `--hue`」这条规则；
- **零 `Math.random()` 调用**（注释里的禁用说明除外）：星点、微偏移、光晕相位都必须刷新一致，否则回归截图每次都不同；
- 每屏可见暖金 ≤2 处（焦点环是瞬时态，不计配额）；需要强调但不占配额的一律用中性亮态 `--bright`；
- 无可访问名的输入 0；各路由 header/nav/main 各 1。

**数据与后端**
- **启动不再预置任何数据**（seed 于 2026-08-12 整个删除）：干净库起来后没有用户也没有作品，注册账号自行创作。原实现每次启动都在生产库上跑夹具代码的删除逻辑（重复项清理、硬删「迷雾古堡」），职责错位。现有库里的 `guest` 与那六部演示作品是历史遗留数据，不会被自动重建，也不会被自动删除。
- `StoryService.SetStatus` 发布前拦空标题（`ValidateWorldConfig` 只管 world_config，管不到标题）。若又出现空标题的已发布作品说明被绕过（如直接改库）：`SELECT id, creator_id FROM stories WHERE status='published' AND btrim(title)=''`，作者仍在则降草稿、已删号则删除。
- 作者署名走 `LEFT JOIN users` 投影 `creator_name`（`gorm:"->;-:migration"` 只读不建列），空则前端**整块不渲染**——统一挂个假作者名比不署名更伤。⚠️ **join 后 `users` 也有 `status`/`created_at`，`listWhere` 里所有列名必须带 `stories.` 前缀。**
- 注册的 username 由**后端**派生（`service.generateUsername`），不由前端 `email.split("@")[0]`——那会让 `a@x` 与 `a@y` 撞车，且报错对不上用户填过的任何一栏。邮箱唯一性**先查**。

## 14. 图片上传（头像 / 作品封面，2026-08-10）

**一句话**：一个通用上传端点产出 URL，绑定由各自已有的更新接口完成；文件落本地磁盘，静态直出。

**接口**
- `POST /api/v1/uploads/image`（AuthRequired，multipart）：字段 `file` + `kind`∈`{avatar, cover}`，返回 `{"url": "/api/v1/uploads/<kind>/<yyyy-mm>/<uuid><ext>"}`。
- `GET /api/v1/uploads/*`：Gin `api.Static` 直出。
- 绑定不走上传接口：头像随 `PUT /auth/profile` 的 `avatar_url` 存，封面随作品保存的 `cover_url` 存。**「上传成功」不等于「已保存」**，这是刻意的——上传没有副作用。

**为什么挂在 `/api/v1/uploads` 而不是裸 `/uploads`**：生产 nginx 只有 `/api/v1/ → 8080` 和 `/ → 3000` 两条 location，裸路径会被转给 Next.js。挂进 API 命名空间后反代规则天然覆盖，前端拼 `NEXT_PUBLIC_API_BASE` 在 dev（绝对地址）与 prod（同源）下都对。**但 nginx 仍需 `client_max_body_size 8m`**（默认 1m 会 413），已写进 `deploy/nginx/story-editor.conf`。

**校验口径（`pkg/upload.go` + `service/upload.go`）**
- 类型判定只看**文件头字节**（`http.DetectContentType`），不信 `Content-Type`、不信扩展名——把 `evil.exe` 改名 `a.png` 必须被挡（有测试）。
- 白名单 jpeg/png/webp/gif。**SVG 故意排除**：它是 XML 可内嵌脚本，而上传目录同源直出，放行等于开存储型 XSS。
- 大小上限 `UPLOAD_MAX_MB`（默认 5MB），用 `io.LimitReader(max+1)` 兜底而非信 `Content-Length`；超限**删除半成品**再报错（有测试）。
- 落盘文件名一律 uuid，不保留原始文件名；`kind` 白名单化（它决定一级目录，否则 `kind=../../etc` 就是路径穿越，有测试）。
- 业务错误码：`10014` 格式不支持、`10015` 超出大小限制。

**服务端不做图片处理**，缩放放在前端（`lib/imageResize.ts`，canvas 等比缩到最长边 avatar 512 / cover 1280，导出 webp q0.85；GIF 跳过以免丢动画；任何一步失败都回退原文件）。理由：省掉图像库依赖与一倍代码量，而手机大图的问题在客户端解决同样彻底。

**为什么不建 `story_assets` 表**：`infa/sql/stories.sql` 里那张表已设计好（oss_key/url/width/height/mime），但它 `story_id NOT NULL`，装不下用户头像；当前也只需要「一张图一个 URL」。本期只加 `users.avatar_url`，沿用已有 `stories.cover_url`。等真做立绘/BGM/素材库再建——届时 `url` 语义不变，不用迁移数据。

**前端接入**
- `lib/api.ts`：`api.upload(kind, file, name)` 是独立的 multipart 通道（**不设 `Content-Type`**，boundary 必须由浏览器带）；`assetUrl(u)` 把相对路径补上 dev 的后端源。
- `components/ImageUpload.tsx`：通用控件（`kind` 决定圆形/矩形预览），真 `<button>` 触发隐藏 file input，上传中/空/失败三态齐全。
- 消费点：`/mine/settings` 头像（保存时**手动双写 localStorage + `useAuthStore.setState`**，否则顶栏与账户菜单读的是旧那份 user，改完昵称/头像顶栏不刷新）、`/mine` 资料头；封面在编辑器段 5「主题与天空」、作品卡与我的作品页。⚠️ 12 部演示作品 `cover_url` 全空，所以**无封面是默认态**：卡片渲染纯 CSS 天空，不是灰占位框。
- **无图时的渲染与改动前完全一致**：所有位置都回落原来的主题渐变 / 昵称首字母，不引入「默认灰头像」这种无信息占位。
- **有图时仍叠一层主题渐变罩层**（`lib/types.ts` 的 `coverStyle`，用 `color-mix` 降透明度）：封面上压着白色标题/摘要/CTA，裸铺照片会让对比度跌破 4.5:1；罩层同时保住「彩色只来自作品主题色」这条铁律。有封面时不加 `.cover.alive`——那个 16s 漂移靠拉伸 `background-size`，用在照片上会变形。

**部署**：`UPLOAD_DIR` 默认 `./uploads`（相对 `backend/`，与 `LoadHTMLGlob("../templates/*")` 同一个 cwd 约束）；容器里用绝对路径 `/data/uploads` 并挂 named volume `uploads`（`deploy/docker/docker-compose.yml`），否则 `up --build` 一次图就全没了。`backend/uploads/` 已进 `.gitignore`。

**已知限制**：孤儿文件无回收、单机本地磁盘（见 §9.2）；作品卡的作者小头像 `.au` 仍是灰圆——`StoryResponse` 只带 `creator_name`，要显示作者头像需按 `CreatorName` 的 `->` + `-:migration` 只读投影再加一列，留待社区期。
