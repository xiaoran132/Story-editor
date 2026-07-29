# Story Editor · AI 互动剧情共创社区

> **当前目标：先验证“AI 互动剧情是否足够好玩、值得继续玩”。**
> 这是一个仍处于 Demo 阶段的全栈项目：玩家可游玩、自由输入、回溯和读档；创作、社区、付费等愿景已完成设计，但尚未进入 MVP 主链路。

**最后梳理：2026 年 7 月 28 日。** 本 README 是项目入口；要接手开发，请按下方“推荐阅读顺序”进入，而不是只读某一份设计稿。

## 先读什么

| 顺序 | 文档 | 用途 | 权威性 |
|---|---|---|---|
| 1 | [开发交接手册](docs/开发交接手册.md) | 当前实现、代码入口、数据契约、运行/验证、风险和下一步 | **当前事实总览** |
| 2 | [CLAUDE.md](CLAUDE.md) | 仓库规则、分层边界、实现约定、可执行命令 | **开发规范** |
| 3 | 本 README | 项目定位、架构、快速启动、当前优先级 | 项目入口 |
| 4 | [Agent README](agent/README.md) / [前端 README](frontend/README.md) | 分别接手 AI 链路或游玩前端时阅读 | 模块事实 |
| 5 | [设计思路](docs/设计思路.md) | 剧情树、JSONB、Agent 演进等技术决策与扩展方案 | 技术设计 |
| 6 | [功能设计](docs/功能设计.md) | 产品愿景、功能边界、长期路线 | PRD；不等于已实现 |
| 7 | [infa/sql](infa/sql/) | 完整数据模型蓝本；部分表尚未在 GORM 中落地 | 数据设计蓝本 |

> **判定冲突时的顺序**：运行中的代码 / 测试 > `docs/开发交接手册.md` > `CLAUDE.md` > 模块 README > 技术设计 > PRD。设计文档中保留了早期设想，不能据此假定功能已存在。

## 产品现状

### 已可用的主链路

```text
选择作品
  → 创建匿名游玩会话
  → Agent 生成开场
  → 推荐选项或自由输入推进剧情
  → AI 生成 + 质量审校（不通过则有限重写）
  → 属性快照、节点树和滚动摘要持久化
  → 回溯历史节点 / 读档续玩 / 删除会话
```

| 模块 | 当前状态 | 说明 |
|---|---|---|
| 游玩后端 | 已完成 | 开局、续写、回溯、读档、删档、同层语义合并 |
| 游玩前端 | 已完成 | 作品列表、会话列表、星图剧情树、选项和自由输入 |
| AI Agent | 已完成阶段一 | 叙事生成、属性入戏、节拍/选项提示、节点摘要、生成后质量复查与有限重写 |
| 用户系统 | 后端已完成 | 注册、登录、JWT、资料；前端尚未接入，游玩仍使用匿名 guest |
| 创作辅助 | Agent 接口已完成 | `/assist/*` 已有，但没有创作前端消费者 |
| 社区 | 未完成 | 路由和 handler 桩存在，浏览/点赞/评论尚未实现 |
| 付费、成就、实时流式 | 未完成 | 仅作为后续方向 |

## 架构

```text
Next.js 前端 :3000
      │ HTTP（/api/v1）
      ▼
Go + Gin 后端 :8080
  ├─ 账号、作品、游玩会话、节点树、属性合并
  ├─ PostgreSQL / GORM
  └─ HTTP 调用 Agent 服务
      │
      ▼
Python FastAPI + LangGraph :8001
  ├─ 生成剧情 JSON
  ├─ 审校候选内容；不合格则反馈重写
  └─ 不直接访问数据库
      │
      ▼
DeepSeek（OpenAI 兼容接口）
```

**职责边界不可跨越：**

- 前端只消费 Go 后端的 `/api/v1`；不直接调用 Agent 或数据库。
- Go 后端是会话、剧情节点、状态快照的唯一持久化编排者。
- Agent 只接收世界观、路径、当前状态和选择，返回结构化结果；**不碰数据库**。
- `play_sessions.current_state` 是会话当前状态的唯一事实来源；节点的 `state_delta` 是增量，`state_snapshot` 用于节点级回溯。

## 快速启动（Windows）

### 前置条件

- Go 1.25+
- Python 3.12+
- Node.js 18+
- PostgreSQL（已创建 `story_editor` 数据库）
- DeepSeek API Key（没有 Key 时服务可启动，但生成接口会返回 502）

### 推荐：一键启动

在仓库根目录执行：

```powershell
.\scripts\dev.ps1

# 只启动一个进程
.\scripts\dev.ps1 -Only agent
.\scripts\dev.ps1 -Only backend
.\scripts\dev.ps1 -Only frontend
```

脚本会在独立窗口启动：Agent `:8001`、后端 `:8080`、前端 `:3000`，并在首次运行时复制示例环境文件、安装前端或 Agent 依赖。

### 必需配置

| 文件 | 关键变量 |
|---|---|
| `agent/.env` | `DEEPSEEK_API_KEY`、可选 `AI_REVIEW_MAX_RETRIES`（默认 `2`） |
| `backend/.env` | `DB_*`、`JWT_SECRET`、`AGENT_URL` |
| `frontend/.env.local` | `NEXT_PUBLIC_API_BASE`，默认 `http://localhost:8080/api/v1` |

### 常用地址

- 游玩前端：http://localhost:3000/
- 后端 API 根：http://localhost:8080/api/v1
- Agent 健康检查：http://localhost:8001/health
- Agent OpenAPI：http://localhost:8001/docs

## 关键实现决策

1. **剧情树而非线性文本**：每次选择生成 `story_nodes` 子节点；回溯只移动会话的 `current_node_id`，不删除分支。
2. **状态采用 JSONB 的“增量 + 快照”**：`state_delta` 表示一次变化，`state_snapshot` 和会话 `current_state` 代表完整状态；属性类型为 `number`、`scalar`、`set`。
3. **长程记忆采用节点摘要优先**：每个节点保存滚动 `summary`；续写时注入最新摘要与最近两段原文；旧数据没有摘要时回退滑动窗口。
4. **AI 内容不直接交付**：`generate → review`。审校拒绝会给出改写要求，最多额外重写 `AI_REVIEW_MAX_RETRIES` 次；仍失败则返回 502，避免将未通过内容写入节点树。
5. **先留存、后扩张**：下一阶段先用真实试玩验证 Agent 的叙事质量、延迟和失败率，再做完整多 Agent/RAG/流式；创作、社区和商业化排后。

## 验证命令

```powershell
# Go 后端
cd backend
go test ./...

# Python Agent：质量复查循环的离线单元测试
cd ..\agent
.\.venv\Scripts\python.exe -m compileall -q app tests
.\.venv\Scripts\python.exe -m unittest discover -s tests -v

# 前端生产构建
cd ..\frontend
npm run build
```

> Agent 的真实端到端验证仍依赖可用的 PostgreSQL 与 DeepSeek Key。离线测试不能替代多回合试玩：必须检查摘要是否漂移、选择后果是否兑现、审校重写率和实际延迟。

## 接手后的首要工作

1. 在真实环境跑多回合游玩，记录 AI 审校通过率、重写率、p95 延迟与典型叙事问题。
2. 给 `PlayService` 增加 `summary` 跨 Go/Python 链路的回归测试；当前 Agent 层已有质量循环测试。
3. 根据试玩数据决定阶段二的最小切入点：先拆 `director/recall/write/critic`、先做 RAG，或先做流式反馈。
4. 只有游玩体验达到可留存水平后，再接入真实登录、创作前端和社区闭环。

更多细节见 [开发交接手册](docs/开发交接手册.md)。
