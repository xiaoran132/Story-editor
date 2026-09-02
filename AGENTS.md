# AGENTS.md

ZCode 会话自动加载的工作区指令。完整工程约束以 [CLAUDE.md](CLAUDE.md) 为准（英文），本文件是精简入口，两者冲突时以 CLAUDE.md 为准；当前事实与状态见 [docs/handoff.md](docs/handoff.md)。总判定顺序：运行中的代码/测试 > `docs/handoff.md` > `CLAUDE.md` > 模块 README > `docs/design.md` > `docs/prd.md`。

## 基本规则

- 回复一律中文。
- 任务完成后同步受影响的文档：**改错的那一行**，不追加段落、不重写整篇（尤其 `docs/handoff.md`）。
- 文档修复只写当前正确的事实，禁止「原本……，现在改为……」这类日志式表述——Git 是变更日志（完整规则见 `CLAUDE.md` 的 Replace, don't append / A review is not a changelog）。
- Demo 阶段、0 用户：不迎合错误前提，完成后自问「能不能更简单」。
- grep 只是线索不是事实——「X 只被 Y 调用」这类结论要落到真实接收方或函数体再写。

## 项目结构与运行

三进程全栈 + PostgreSQL：Next.js 前端 `:3000` / Go+Gin 后端 `:8080` / Python FastAPI Agent `:8001`。

| 目录 | 内容 |
|---|---|
| `backend/` | Go 后端（账号/作品/游玩会话/节点树/BYOK 计费） |
| `frontend/` | Next.js 14 + React 18 + Zustand 游玩与创作前端 |
| `agent/` | AI 生成服务（唯一编排在 `app/graph/story_graph.py` 的 `_stream_pipeline`） |
| `docs/` | handoff（当前事实）、design、prd、context-strategy、design/（UI 规范） |
| `infa/sql/` | 数据模型蓝本，**启动时不执行**；运行 schema 只由 AutoMigrate 构建 |
| `templates/` | Gin 占位遗留，已被 `frontend/` 取代 |

```powershell
.\scripts\dev.ps1        # 一键启动三进程；-Only agent|backend|frontend 单进程
```

⚠️ 后端必须从 `backend/` 目录运行：`main.go` 的 `LoadHTMLGlob("../templates/*")` 和 viper 的 config 路径都是相对的。

## 验证命令

```powershell
cd backend; go test ./...                 # 默认无需 PostgreSQL（fake 注入）；集成测试 -tags=integration 需 TEST_DB_DSN
cd frontend; npm run lint; npm run typecheck; npm run test   # lint 是 --max-warnings 0；PowerShell 下 build 用 npm.cmd；test 是 vitest
cd agent; .\.venv\Scripts\python.exe -m compileall -q app tests
cd agent; .\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

改属性/合并逻辑必跑 `backend` 的 `play_merge_test.go`——Go `mergeState` 与 Python `normalize` 的契约测试，改一侧必跑另一侧。

## 架构铁律

- 后端分层 `handler → service → repository` 单向；handler 无逻辑、service 无 SQL。
- **模块缝**：模块（user/story/play/llm/community）禁止 import 其他模块的 repository，跨模块读走 `internal/service/ports.go` 窄接口。
- 前端只消费 Go 的 `/api/v1`；浏览器绝不直连 Agent（无 CORS 无鉴权，Go 是唯一调用方）。
- Agent 不碰数据库、不持有任何 LLM 凭据（配置由 Go 随请求下发，缺失即硬错误，无回退）。
- `_stream_pipeline` 是唯一生成编排；其中所有同步 `chat_json` 必须包 `await asyncio.to_thread(...)`（`chat_stream` 已是异步，不要包）。
- 审校绝不阻断玩家回合：拒绝 → 有记忆修订，超限 → 降级交付（`degraded=1`）。
- `play_sessions.current_state` 是会话当前状态的唯一事实来源；节点 `state_delta` 是增量、`state_snapshot` 用于回溯。
- 后端 config 新增 key 要动四处：`Config` 字段、`BindEnv`、`setDefaults()`、两个 env.example（`backend/` 与 `deploy/docker/`）。

## 错误与文案

- 错误只用 `pkg/errors.go` 的 `AppError`；响应只用 `pkg.Success/Created/Error/NoContent`，绝不用 `c.JSON`。
- 每条 `AppError.Message` 都是**用户可见中文**；底层错误原文绝不外发，`pkg.SafeDetail` 是唯一出口。SSE 路由的错误以 `event: error` 帧送出（200 头已提交）。
- 剧情树查询用 Postgres 递归 CTE，**不要在 Go 里递归**。

## 前端设计系统

- 深空墨色底是所有屏幕的前提，白底即回归；token 只在 `frontend/app/globals.css`（实现 `docs/design/DESIGN.md` §3/§4），页面几何进各自 CSS Module。
- 颜色一律 `oklch()`，样式表里不出现 hex；`--w-*` 角色色声明在使用它的元素上，不在 `:root`。

## 改敏感区前必读

| 区域 | 先读 |
|---|---|
| 属性类型 / 状态合并 / 游玩管线 | `docs/design.md`「属性类型分类」「节点语义合并与去重」 |
| 上下文与长程记忆 | `docs/context-strategy.md` |
| Agent 阶段二/三（记忆/导演/NPC）设计、`llm.py` 计费与 SSE 处理 | `docs/external-lessons.md` |
| 任何 UI 表面 | `CLAUDE.md` §Frontend design system + `docs/design/DESIGN.md` |
| BYOK / 计费 / 平台额度 | `docs/handoff.md` §12 |
