# 前端（游玩）

AI 互动剧情的**游玩前端**：作品选择 → 作品详情/过渡页 → 游玩体验（选项/自由行动/回溯）、历史会话读档续玩+删档。

技术栈：Next.js 14（App Router）+ React 18 + TypeScript + Zustand。样式为单份全局 CSS（`app/globals.css`），采用**「星图」主题**——深空藏蓝底 + 星光双主色（冷蓝 `--glow` 表结构/连线，暖金 `--star` 表"你所在/主线"）；显示字体 Space Grotesk（`next/font`），正文用衬线（Songti/Noto Serif）。签名件是发光的剧情星图树。

> 登录/注册为**可选**：未登录沿用后端匿名 guest 用户，登录后迁移本浏览器 guest 会话到账号（见 `AuthWidget`/`store/authStore`）。

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
| `/` | 首页：星图 hero + `GET /stories/` 作品列表 + `GET /play/sessions` 我的历史会话（读档）。点作品 → 跳**作品详情页** `/story/:id`；点会话 → 直接续玩；会话卡右上角 → 二次确认后 `DELETE /play/sessions/:id` 删档（乐观移除）。 |
| `/story/[storyId]` | 作品详情/过渡页：`GET /stories/:id` 展示标题/简介 + 从 `world_config` 提炼的背景/风格/登场人物；「开始新游戏」→ `POST /play/sessions` 建**空会话**并跳转游玩（开局正文在游玩页流式生成）。 |
| `/play/[sessionId]` | 游玩页（新开局与续玩共用）：挂载 `GET /play/sessions/:id`。顶栏显示**剧本名**（`playStore.storyTitle`）。布局为**左侧状态台（`AttrBar`）+ 中间正文/选项**两列；星图树移入**右侧抽屉**（顶栏「✦ 星图」切换，仅 >1 节点可用，遮罩/Esc/回溯后关闭）。若 `current_node=null`（空会话）→ 触发 `startOpening()` 流式生成开局（`…/opening/stream`）；选项/自由行动 → 流式 `…/choice/stream`；点星图历史节点 → `POST …/backtrack`。正文流式逐字显示（`streamingText`+光标）。 |

## 目录结构

```
frontend/
├── app/
│   ├── layout.tsx                 # 全局壳
│   ├── globals.css                # 主题变量 + 全部样式
│   ├── page.tsx                   # 首页（作品 + 读档）
│   ├── story/[storyId]/page.tsx   # 作品详情/过渡页
│   └── play/[sessionId]/page.tsx  # 游玩页（状态台 + 正文 + 星图抽屉）
├── lib/
│   ├── api.ts                     # fetch 封装（解 {success,data,error} 信封）
│   ├── types.ts                   # 与后端 DTO 对齐的类型
│   ├── state.ts                   # JSON 字符串字段解析 + 当前路径 buildPath 重建
│   └── tree.ts                    # 剧情线树布局（buildChildrenMap / layoutTree）
├── store/playStore.ts             # Zustand 游玩状态机（load/choose/backtrack，常驻 allNodes）
└── components/                    # StoryCard / SessionCard / AttrBar / StoryPane / OptionList / StoryTree
```

## 与后端契约的要点

- 响应信封统一为 `{ success, data, error, meta }`，`lib/api.ts` 只返回 `data`，失败抛 `error.message`。
- **流式续写**：`choose` 走 `lib/api.ts` 的 `postStream` → `POST /play/sessions/:id/choice/stream`（SSE）。`delta` 帧累积到 `store.streamingText`（`StoryPane` 逐字显示 + 光标），`revise` 帧清空重来，`done` 帧携带持久化后的 `SessionResult`。流式期间 `busy=true`，选项隐藏、正文脉冲；结束回落 `currentNode.content`。
- `current_state`、`suggested_options`、`state_snapshot`、`revealed_attrs` 后端以 **JSON 字符串** 返回，需经 `lib/state.ts` 解析后使用。属性键经 `attrLabel` 映射中文、值经 `formatAttrValue` 兜底对象渲染、变化经 `formatDelta` 显示徽标。
- **属性可见性**（`AttrBar`）：显示某属性当且仅当 `非 hidden ∧（非 reveal 门控 ∨ 已在 session.revealed_attrs 揭示）`。`hidden`/`reveal` 键由 `playStore` 从作品 `world_config.attributes` 解析（`parseFlaggedAttrs`），揭示集由后端随会话下发。语义详见交接手册 §5.3。
- 续玩时后端只返回全部节点与 `current_node_id`；`store` 常驻这份 `allNodes`，`lib/tree.ts` 的 `layoutTree()` 用 `parent_id`/`depth` 建成**剧情线树**（SVG 节点连线图），完整展示已探索的全部分支——回溯不删数据，故被放弃的分支也在树上（变暗）。当前路径由 `buildPath()` 沿 `parent_id` 回溯并高亮。
```
