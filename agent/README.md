# Story Editor · Agent 服务

> Python FastAPI + LangGraph 服务。职责是把“世界观 + 剧情路径 + 当前状态 + 玩家行动”转换为**经 AI 质量审校的结构化剧情结果**。它是独立进程，**不访问 PostgreSQL，也不持久化任何剧情数据**；Go 后端是唯一的调用者和写库者。

## 先了解什么

- 项目全局状态和接手方式：[开发交接手册](../docs/开发交接手册.md)
- 后端与 JSONB 状态约定：[CLAUDE.md](../CLAUDE.md)
- 长程剧情记忆方案：[剧情上下文构建方案](../docs/剧情上下文构建方案.md)

## 职责与边界

| Agent 负责 | Agent 不负责 |
|---|---|
| 构建 LLM 上下文、生成剧情 JSON、审校质量、规整模型输出 | 数据库、会话归属、状态持久化、鉴权、前端展示 |
| 生成正文、选项、`state_delta`、滚动 `summary` | 合并 `state_delta`、创建 StoryNode、更新 PlaySession |
| `/assist/*` 创作辅助和 `/merge-check` 语义判断 | 决定是否复用节点、执行业务权限 |

Go 侧契约实现位于 `backend/internal/service/agent_client.go`；游玩调用方是 `backend/internal/service/play.go`。

## 目录与入口

```text
agent/
├── app/
│   ├── main.py                  # FastAPI 装配、/health
│   ├── config.py                # .env / 环境变量配置
│   ├── llm.py                   # DeepSeek（OpenAI 兼容）JSON 调用
│   ├── prompts.py               # 生成、审校、创作辅助、合并判断提示词
│   ├── schemas.py               # 与 Go 对齐的 Pydantic 请求/响应模型
│   ├── graph/
│   │   ├── state.py             # LangGraph 共享状态
│   │   └── story_graph.py       # 游玩生成/审校工作流
│   └── routers/
│       ├── generate.py          # /generate、/continue、/merge-check
│       └── assist.py            # /assist/*
├── tests/
│   └── test_story_graph_review.py # 审校重写循环离线测试
├── .env.example
└── requirements.txt
```

## 核心工作流：生成后必须审校

```mermaid
flowchart LR
  P["prepare\n拼世界观/历史/属性/选择"] --> G["generate\n候选 JSON"]
  G --> R["review\n低温 AI 审校"]
  R -->|"passed=true"| N["normalize\n类型和结局规整"]
  R -->|"passed=false"| G
  N --> O["返回 AIResult 给 Go"]
```

### 节点职责

1. `prepare`
   - 开局：写入世界观、初始状态、属性类型。
   - 续写：写入节点路径、最近滚动摘要、最近原文、当前状态与玩家选择。
   - 锁定允许出现在 `state_delta` 中的属性键和类型。

2. `generate`
   - 调用 `STORY_SYSTEM`，一次输出 `content`、`options`、`state_delta`、`summary`、结局字段。
   - 若上一稿审校失败，附上 `issues`，要求完整重写 JSON。

3. `review`
   - 调用低温 `REVIEW_SYSTEM`，返回 `{"passed": true|false, "issues": [...]}`。
   - 审查世界观/历史承接、属性入戏、剧情推进、选项差异和后果、`state_delta`、`summary` 与结局一致性。

4. `normalize`
   - 仅在审校通过后运行。
   - 将选项规整为 `{text, hint}`，过滤非法属性键，按 `number/scalar/set` 类型规整 delta，并修正非法 `ending_type`。

### 重试边界

`AI_REVIEW_MAX_RETRIES` 控制审校拒绝后允许的**额外重写次数**，默认 `2`。

- 首稿通过：1 次生成 + 1 次审校。
- 连续失败：最多“初稿 + 2 次重写”，每一稿均审校。
- 超过上限：`story_graph.py` 抛出 `ValueError`；路由把它转成 HTTP **502**；不会返回未审校通过的结果。

这是刻意的有限循环：无限“直到合格”会在模型持续自我否定时耗尽费用和请求时间。若要提升质量，应调整审校标准、提示词、上下文或模型，而不是取消上限。

### 埋点（可观测性）

`story_graph.py` 打两类 `story.metrics` 日志（logfmt）：

- `gen` —— 每次生成流一行（`_invoke_with_metrics`）：`mode`、`outcome`、`elapsed_ms`、成功附 `review_failures`(0=首稿通过)/`first_draft_pass`/`is_ending`，失败附 `err_type`/`detail`。`outcome` 细分 `ok`/`parse_error`(LLM 非法 JSON)/`review_exhausted`(审校超限)/`error`。
- `review` —— 每次审校判定一行：`verdict`(pass/reject)、`attempt`、拒绝附 `issues`。

用 `tools/sample_metrics.py [每世界续写轮数]` 在进程内直驱采样并聚合（不经 HTTP、不碰 DB，避免 uvicorn 吞掉 INFO；会真实调用 DeepSeek）。背景与取舍见交接手册 §9.1。

## 长程记忆与 `summary`

每个成功生成的剧情节点都包含滚动 `summary`。Go 将它持久化到 `story_nodes.summary`，下一次续写会把历史中最近非空摘要写为 `【前情提要】`，再补最近 2 段原文。

```text
优先：最新 summary + 最近 2 段原文 + 当前状态/选择
兜底：老节点没有 summary → 开局 + 最近 HISTORY_WINDOW 段原文
```

- `summary` 必须保留关键人物、关系、地点/物品、伏笔和不可逆事件。
- 它是有损压缩，可能漂移；复杂支线后续再用 RAG 补精确细节。
- 详细权衡在 [剧情上下文构建方案](../docs/剧情上下文构建方案.md)。

## 运行

### 配置

```bash
cd agent
copy .env.example .env  # Windows；填入 DEEPSEEK_API_KEY
```

| 变量 | 默认 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 空 | 必填；缺失时接口生成会失败 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | OpenAI 兼容服务地址 |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 模型名称 |
| `AI_TEMPERATURE` | `0.8` | 正文生成随机性 |
| `AI_TIMEOUT` | `60` | 单次 LLM 调用超时（秒） |
| `AI_REVIEW_MAX_RETRIES` | `2` | 审校拒绝后的额外完整重写次数 |
| `HISTORY_WINDOW` | `8` | 老数据无摘要时的滑动窗口大小；`<=0` 为全量历史 |

### 启动与检查

```powershell
# Windows
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload

# 或从仓库根启动全部服务
..\scripts\dev.ps1 -Only agent
```

- 健康检查：`GET http://localhost:8001/health`
- OpenAPI：`http://localhost:8001/docs`

## 接口

| 方法 | 路径 | 调用方 / 作用 |
|---|---|---|
| `POST` | `/generate` | Go `StartSession`：生成开场 |
| `POST` | `/continue` | Go `MakeChoice`：根据路径和选择续写 |
| `POST` | `/merge-check` | Go `tryMerge`：候选分支语义等价判断 |
| `POST` | `/assist/world` | 创作辅助：灵感 → 世界观/属性声明 |
| `POST` | `/assist/opening` | 创作辅助：世界观 → 开场草稿 |
| `POST` | `/assist/polish` | 创作辅助：文本润色 |
| `POST` | `/assist/branches` | 创作辅助：分支建议 |
| `GET` | `/health` | 运行状态和模型配置检查 |

`/generate` 与 `/continue` 的成功响应：

```json
{
  "content": "剧情正文",
  "options": [
    {"text": "正面交涉", "hint": "可能获得信任，但会暴露目的"}
  ],
  "state_delta": {"hp": -10},
  "summary": "截至本段的前情提要",
  "is_ending": false,
  "ending_type": ""
}
```

失败时路由返回 HTTP 502；Go `AgentClient` 将其视为 Agent 调用失败。不要在 Python 侧吞掉审校耗尽等异常后返回半成品。

## 属性类型契约

创作者可通过 `world_config.attributes` 声明属性类型。Agent 的生成和 `normalize` 必须遵守：

| 类型 | 合法 delta | 示例 |
|---|---|---|
| `number` | 数值增减 | `{"hp": -10}` |
| `scalar` | 新值覆盖 | `{"location": "王城"}` |
| `set` | `add/remove` | `{"items": {"add": ["钥匙"], "remove": ["火把"]}}` |

未声明属性类型的老作品仍可工作：Agent 透传，Go 的 `mergeState` 负责兼容推断。修改这里时必须同时检查 `agent/app/schemas.py`、`backend/internal/service/agent_client.go` 和 `backend/internal/service/play.go`。

## 测试与修改清单

```powershell
cd agent
.\.venv\Scripts\python.exe -m compileall -q app tests
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

当前 `tests/test_story_graph_review.py` 至少覆盖：

- 审校拒绝时，重写 prompt 包含具体反馈；
- 达到最大重试次数后，绝不交付未通过内容。

修改 Agent 时还必须在真实环境连续试玩：检查上下文是否正确、摘要是否漂移、选项后果是否兑现、审校重写率与延迟是否可接受。
