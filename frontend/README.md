# 前端（游玩）

AI 互动剧情的**游玩前端**：作品选择、游玩体验（选项/自由行动/回溯）、历史会话读档续玩。

技术栈：Next.js 14（App Router）+ React 18 + TypeScript + Zustand。样式为单份全局 CSS（`app/globals.css`），沿用后端占位页的暗色古典 + 金色点缀 + 衬线主题。

> 本前端只做「游玩」链路，登录/注册尚未接入——游玩沿用后端的匿名 guest 用户。

## 快速开始

```bash
cd frontend
npm install
cp .env.local.example .env.local   # 按需修改 NEXT_PUBLIC_API_BASE
npm run dev                         # http://localhost:3000
```

Windows 下也可用仓库根的 `.\scripts\dev.ps1`（默认一并拉起 AI/后端/前端；`-Only frontend` 只起前端）。

需要后端（:8080）与 AI 服务（:8001）在运行；后端 CORS 已放行所有来源。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `NEXT_PUBLIC_API_BASE` | `http://localhost:8080/api/v1` | Go 后端 API 基址（含 `/api/v1`） |

## 页面

| 路由 | 说明 |
|------|------|
| `/` | 首页：`GET /stories/` 作品列表 + `GET /play/sessions` 我的历史会话（读档）。点作品 → `POST /play/sessions` 建会话并跳转游玩；点会话 → 直接续玩。 |
| `/play/[sessionId]` | 游玩页（新开局与续玩共用）：挂载时 `GET /play/sessions/:id` 拉会话+当前节点+全部节点。选项/自由行动 → `POST …/choice`；点时间线节点 → `POST …/backtrack`。 |

## 目录结构

```
frontend/
├── app/
│   ├── layout.tsx                 # 全局壳
│   ├── globals.css                # 主题变量 + 全部样式
│   ├── page.tsx                   # 首页（作品 + 读档）
│   └── play/[sessionId]/page.tsx  # 游玩页
├── lib/
│   ├── api.ts                     # fetch 封装（解 {success,data,error} 信封）
│   ├── types.ts                   # 与后端 DTO 对齐的类型
│   └── state.ts                   # JSON 字符串字段解析 + 时间线 path 重建
├── store/playStore.ts             # Zustand 游玩状态机（load/choose/backtrack）
└── components/                    # StoryCard / SessionCard / AttrBar / StoryPane / OptionList / Timeline
```

## 与后端契约的要点

- 响应信封统一为 `{ success, data, error, meta }`，`lib/api.ts` 只返回 `data`，失败抛 `error.message`。
- `current_state`、`suggested_options`、`state_snapshot` 后端以 **JSON 字符串** 返回，需经 `lib/state.ts` 解析后使用。
- 续玩时后端只返回全部节点与 `current_node_id`；时间线的当前路径由 `buildPath()` 沿 `parent_id` 向根回溯得到。
```
