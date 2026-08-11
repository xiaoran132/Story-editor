# 前端（游玩）

AI 互动剧情的**游玩前端**：作品选择 → 作品详情/过渡页 → 游玩体验（选项/自由行动/回溯）、历史会话读档续玩+删档。

技术栈：Next.js 14（App Router）+ React 18 + TypeScript + Zustand。样式为单份全局 CSS（`app/globals.css`），落地 `docs/design` 的**双态设计体系**：

- **管理态**（默认 `:root`，白底 + Inter 无衬线 + 结构化）：发现/书库、我的创作、社区、个人主页/设置、创作编辑器、登录表单、admin。全局导航头 `AppHeader`（sticky 毛玻璃 + 分支节点品牌）。
- **阅读态**（`.od-reading`，暖深色 + Noto Serif SC 衬线 + 半透明阅读遮罩）：作品详情、游玩、登录左氛围栏。分层 CSS 场景背景 + 遮罩浓度/昼夜可调（存 localStorage）。

字体：Inter（`--font-sans`）+ Noto Serif SC（`--font-serif`），均经 `next/font`。**作品主题皮肤**（8 套：star/ink/horror/sci/love/xian/heal/radio，见 `lib/types.ts` 的 `THEMES`）仅在阅读态整页换肤（`lib/useReadingTheme.ts` 把 `od-reading` + `data-work-theme` 挂到 `<html>`，离开清除）；管理态外壳永远中性，彩色只来自作品自身（封面渐变 / 阅读场景）。签名件是发光的剧情星图树（阅读态星图抽屉内）。

> **游玩必须登录**：未登录只能浏览已发布作品，详情页拦截并引导登录（额度挂账号）。匿名会话与登录后迁移已移除，见 `docs/handoff.md` §9.2。

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
| `/`（发现） | **管理态**：`AppHeader` 导航 + hero + 题材 chip（**前端过滤**，按作品主题）+ 顶栏搜索（前端过滤已加载列表）+ 书库**错落瀑布**（`StoryCard` 封面卡，封面用作品主题渐变）+ 「继续你的旅程」历史会话（`SessionCard`）。备加载(骨架)/空/错误三态（`components/State.tsx`）。 |
| `/login` | 登录/注册页：左**阅读态**暗色氛围栏 + 右**管理态**表单（tab 切换、密码显隐、`role=alert` 校验、「先以匿名身份进入」）。接 `authStore.login/register`（注册后自动登录）。 |
| `/community` | 社区占位（**后端路由未注册**）：管理态外壳 + 空态 + 去发现出路。 |
| `/mine`·`/me`·`/admin`·`/create`·`/edit/[id]` | 管理态：均挂 `AppHeader`。我的创作、个人主页 + BYOK 连接、平台 AI 设置、创作编辑器（AI 优先流程 + 结构化属性表 + 8 主题 swatch）。 |
| `/story/[storyId]` | **阅读态**作品详情/过场：`useReadingTheme(theme)` 整页换肤 + 背景三层 + 居中 `scrim` 面板（kicker/衬线标题/世界观/登场人物/**属性预览**（hidden/reveal 门控作锁定占位）/生成设置折叠 `StoryLLMConfigPanel`）；「开始新游戏」→ `POST /play/sessions` 建**空会话**跳游玩。 |
| `/play/[sessionId]` | **阅读态**游玩页：`GET /play/sessions/:id`。三栏对称舞台（左 `AttrBar` 状态轨 + 中 `scrim` 正文 + 右旅程轨）+ 悬浮控制条（遮罩浓度滑块→`--scrim-alpha`、昼/夜→`data-mode` 存 localStorage、星图按钮）+ 底部选项坞（编号选项 + **1/2/3 键盘快捷键** + 自由输入）+ 右滑星图抽屉（`StoryTree` 回溯）。正文衬线逐字流式（`streamingText`+光标，**无首字下沉**）；生命周期指示 gen/done/error。`current_node=null` → `startOpening()` 流式开局；选项/自由行动 → `…/choice/stream`；点星图节点 → `…/backtrack`。 |

## 目录结构

```
frontend/
├── app/
│   ├── layout.tsx                 # 全局壳（Inter + Noto Serif SC 字体注入）
│   ├── globals.css                # 双态 token + 管理态组件层 + 阅读态组件层
│   ├── page.tsx                   # 发现/书库（管理态瀑布）
│   ├── login/page.tsx             # 登录/注册（双栏）
│   ├── community/page.tsx         # 社区占位
│   ├── mine|me|admin|create|edit  # 管理态页（均挂 AppHeader）
│   ├── story/[storyId]/page.tsx   # 作品详情/过场（阅读态）
│   └── play/[sessionId]/page.tsx  # 游玩页（阅读态三栏 + 星图抽屉）
├── lib/
│   ├── api.ts                     # fetch 封装（解 {success,data,error} 信封）
│   ├── types.ts                   # 后端 DTO 类型 + THEMES(8) + themeAccent/Gradient/Label
│   ├── state.ts                   # JSON 字符串字段解析 + 当前路径 buildPath 重建
│   ├── tree.ts                    # 剧情线树布局（buildChildrenMap / layoutTree）
│   └── useReadingTheme.ts         # 阅读态挂载 hook（od-reading + 昼夜/作品主题）
├── store/                         # playStore / editorStore / authStore
└── components/                    # AppHeader / State(三态) / StoryCard / SessionCard
                                   # AttrBar / StoryPane / OptionList / StoryTree
                                   # AuthWidget / LLMSettings / StoryLLMConfigPanel / editor/*
```

## 与后端契约的要点

- 响应信封统一为 `{ success, data, error, meta }`，`lib/api.ts` 只返回 `data`，失败抛 `error.message`。
- **流式续写**：`choose` 走 `lib/api.ts` 的 `postStream` → `POST /play/sessions/:id/choice/stream`（SSE）。`delta` 帧累积到 `store.streamingText`（`StoryPane` 逐字显示 + 光标），`revise` 帧清空重来，`done` 帧携带持久化后的 `SessionResult`。流式期间 `busy=true`，选项隐藏、正文脉冲；结束回落 `currentNode.content`。
- `current_state`、`suggested_options`、`state_snapshot`、`revealed_attrs` 后端以 **JSON 字符串** 返回，需经 `lib/state.ts` 解析后使用。属性键经 `attrLabel` 映射中文、值经 `formatAttrValue` 兜底对象渲染、变化经 `formatDelta` 显示徽标。
- **属性可见性**（`AttrBar`）：显示某属性当且仅当 `非 hidden ∧（非 reveal 门控 ∨ 已在 session.revealed_attrs 揭示）`。`hidden`/`reveal` 键由 `playStore` 从作品 `world_config.attributes` 解析（`parseFlaggedAttrs`），揭示集由后端随会话下发。语义详见交接手册 §5.3。
- 续玩时后端只返回全部节点与 `current_node_id`；`store` 常驻这份 `allNodes`，`lib/tree.ts` 的 `layoutTree()` 用 `parent_id`/`depth` 建成**剧情线树**（SVG 节点连线图），完整展示已探索的全部分支——回溯不删数据，故被放弃的分支也在树上（变暗）。当前路径由 `buildPath()` 沿 `parent_id` 回溯并高亮。
```
