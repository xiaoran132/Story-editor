# Story Editor · Agent 服务

> Python FastAPI 服务。职责是把“世界观 + 剧情路径 + 当前状态 + 玩家行动”**流式**转换为**经 AI 质量审校的结构化剧情结果**。生成编排是单条自研流水线 `_stream_pipeline`（未用 langgraph）。它是独立进程，**不访问 PostgreSQL，也不持久化任何剧情数据**；Go 后端是唯一的调用者和写库者。

## 先了解什么

- 项目全局状态和接手方式：[开发交接手册](../docs/handoff.md)
- 后端与 JSONB 状态约定：[CLAUDE.md](../CLAUDE.md)
- 长程剧情记忆方案：[剧情上下文构建方案](../docs/context-strategy.md)

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
│   │   ├── state.py             # 生成流水线共享状态（TypedDict）
│   │   └── story_graph.py       # 流式生成编排 _stream_pipeline + prepare/normalize/review
│   └── routers/
│       ├── generate.py          # /generate/stream、/continue/stream、/opening/complete、/merge-check
│       └── assist.py            # /assist/*
├── tests/
│   ├── test_stream.py          # 流式管线：哨兵/兜底/拒绝修订/超限降级
│   └── test_llm_parse_retry.py # parse 重试恢复/耗尽
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

2. `generate` / 写手
   - 调用 `STORY_SYSTEM`（流式为 `STORY_STREAM_SYSTEM`），一次输出 `content`、`options`、`state_delta`、`summary`、结局字段。
   - 审校失败时用**有记忆的写手**修订：把上一稿 + `issues` 追加进写手对话（`writer_msgs`），令其在上一稿上**修订**而非从头重写（减少震荡、更快收敛）。审校（`review`）本身无记忆、每次新鲜评判。

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
- 超过上限：**降级交付最后一稿**（`deliver_degraded` 节点，打 `degraded=1` 埋点），**不再硬失败**。理由：属性/state_delta 只是辅助 AI 分析与玩家参考的手段，轻微不精确可容忍；宁可交付略有瑕疵的剧情，也绝不让玩家的操作失败。

审校采**分级**（`REVIEW_SYSTEM`）：只拦阻断级硬伤（正文与设定/前情/选择直接矛盾、正文无推进、非结局无选项/选项雷同、summary 篡改关键不可逆事实、JSON 结构坏）；delta 数值精度、未遂动作是否记账、hint 措辞等模糊情形一律放行。这是刻意的有限循环：无限“直到合格”会在模型自我否定时耗尽费用与时间。

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
- 详细权衡在 [剧情上下文构建方案](../docs/context-strategy.md)。

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
| `AI_REVIEW_MAX_RETRIES` | `2` | 审校拒绝后的额外重写/修订次数 |
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
| `POST` | `/generate/stream` | Go `StartStoryStream`：流式开场（AI 生成开局的作品） |
| `POST` | `/continue/stream` | Go `ContinueStream`：流式续写 |
| `POST` | `/opening/complete` | Go `StartSession` 预设开场：补起始选项 + summary |
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

真失败（LLM 非法 JSON 重试耗尽、网络/API 异常）：流式端点以 SSE `error` 帧告知，`/opening/complete`·`/merge-check` 返回 HTTP 502。审校超限**不算失败**（降级交付最后一稿）。

### 流式（SSE）

`/continue/stream` `/generate/stream` 返回 `text/event-stream`，帧格式：

```
event: delta   data: {"text":"增量正文"}     # 正文逐字（哨兵 <<<META>>> 之前）
event: revise  data: {}                       # 审校拒绝 → 下游清空已流出正文，准备重来
event: done    data: {<完整 AIResult>}        # 结束，携带 content/options/state_delta/summary/...
event: error   data: {"detail":"..."}         # 流已开始，异常只能以 error 帧告知
```

实现：`generate` 单次输出「正文 `<<<META>>>` JSON尾」，正文流式外发、结束后解析尾部；尾缺失/非法用 `STRUCTURE_SYSTEM` 兜底；再跑 review，拒绝则发 `revise` 带反馈重来（上限 `AI_REVIEW_MAX_RETRIES`）。见 `graph/story_graph.py` 的 `_stream_pipeline`。埋点在成功时多打 `stream=1 ttfb_ms=<首字延迟>`。

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

当前 `tests/test_story_graph_review.py` 与 `tests/test_stream.py` 至少覆盖：

- 审校拒绝时，重写 prompt 包含具体反馈；
- 达到最大重试次数后，降级交付最后一稿（不硬失败）；
- 流式哨兵解析 / 结构化兜底 / 拒绝 revise 重来 / 超限降级交付。

修改 Agent 时还必须在真实环境连续试玩：检查上下文是否正确、摘要是否漂移、选项后果是否兑现、审校重写率与延迟是否可接受。
