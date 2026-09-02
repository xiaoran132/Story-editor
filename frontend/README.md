# 前端

AI 互动剧情共创社区的前端：星海（首页）→ 作品馆 / 作品详情 → 游玩（选项 / 自由行动 / 回溯）；以及创作编辑器与账户菜单下的「我的空间」五页。

技术栈：Next.js 14（App Router）+ React 18 + TypeScript + Zustand。

**样式只有两个去处**：`app/globals.css`（全站唯一一份全局表：token + reset + 共享组件层）+ 每页/每组件一份 CSS Module。落地的是 `docs/design/` 的**万象设计体系**——深空墨底 + 纯黑剪影 + CSS/SVG 生成的天空，每部作品一个 `--hue`(0–360) 驱动整套 `oklch()` 派生色。**没有模式切换这回事，全站恒定深空**。设计规格看 `docs/design/DESIGN.md`（token 的真源在 §3–§4，本目录的 CSS 是它的实现）；工程侧的铁律看仓库根 `CLAUDE.md` 的 §Frontend design system。

字体：Inter（`--font-ui`）+ Noto Serif SC（`--font-display`），均经 `next/font` 注入。⚠️ 注入的变量名（`--font-sans-inter` / `--font-serif-noto`）与 CSS 里引用它们的名字**必须错开**，同名会让后加载的 `globals.css` 覆盖掉真实字体名、webfont 白下载。

> **游玩必须登录**：未登录只能浏览已发布作品，详情页拦截并引导登录（额度挂账号）。匿名会话与登录后迁移已移除，见 `docs/handoff.md` §9.2。

## 快速开始

```bash
cd frontend
npm install
cp .env.local.example .env.local   # 按需修改 NEXT_PUBLIC_API_BASE
npm run dev                         # http://localhost:3000
```

上面是 bash 语境。**PowerShell 里要写 `npm.cmd` / `npx.cmd`** —— 裸 `npm` 是个 shell 脚本，会受执行策略限制。Windows 下更省事的是仓库根的 `.\scripts\dev.ps1`（默认一并拉起 AI/后端/前端；`-Only frontend` 只起前端）。

需要后端（:8080）与 AI 服务（:8001）在运行；后端 CORS 已放行所有来源。

## 验证

无自动化测试、无 CI，下面三条本地跑通就是全部门禁；视觉另需与 `docs/design/*.html` 并排比（`lint`/`typecheck`/`build` 证明不了像不像）。

```bash
npm run lint        # --max-warnings 0：警告即失败
npm run typecheck   # tsc --noEmit
npm run build
```

⚠️ **`npm run build` 会重写 `.next`，而 dev server 正读着它**——并行跑必然把 dev 弄坏（表现是 CSS 模块半缺失：满屏白剪影、星系空无一卡）。先停 dev 再 build。

两条静态复核（应当无输出）：

```bash
rg -n '#[0-9a-fA-F]{3,6}' src -g '*.css'   # 派生色一律 oklch
rg -n 'Math\.random\(' src       # 确定性伪随机走 lib/prng.ts
```

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `NEXT_PUBLIC_API_BASE` | `http://localhost:8080/api/v1` | Go 后端 API 基址（含 `/api/v1`） |

## 信息架构

```
顶栏主导航（3 项）   星海 /  ·  作品馆 /works  ·  社区 /community    ← 只放公共入口，不随登录态变形
顶栏右侧账户区       已登录：头像 → 下拉菜单 ｜ 匿名：登录 + 注册
  下拉菜单           空间 /mine · 我的作品 /mine/works · 历史记录 /mine/history
                     · 消息 /mine/inbox · 设置 /mine/settings（admin 另有 /admin）· 退出登录
/mine/* 页内二级导航  SubNav（与账户菜单不重复：一个是全局入口，一个是区内导航）
无入口的独立页       /story/[id] · /play/[id] · /create · /edit/[id] · /login · not-found
```

**个人向的新页面一律加进账户菜单**（`components/wx/AccountMenu.tsx` 的 `ITEMS`），不要往主导航上挂。

环境色相（整片深空跟着当前作品走）没有独立 hook：各页在自己的根元素上内联 `--ambient-hue`，由 `globals.css` 的 `.wx-space` 消费，离开该页自然回落 252。

⚠️ 顶栏分两态，两个入口**永不同屏**。判定要等 `authStore.hydrated`——服务端与客户端首帧都读不到 localStorage，直接按 `user === null` 画会让已登录的人先闪一下「登录 / 注册」；补水前两态都不渲染，标记一致故不会 hydration mismatch。

## 页面

| 路由 | 说明 |
|------|------|
| `/` 星海 | 3D CSS 星系（`transform-style: preserve-3d`，**无 Three.js/WebGL**）：四种排布（星系 / 银河 / 书架 / 混沌）+ 拖拽旋转与惯性 + 2.6s 开屏。数据 `GET /stories?sort=plays&limit=12`。点卡片 → 星系转向 + 虚化后退 + `WorkDetail` 浮层。⚠️ ≤820px 降级为 2D 天空墙（小屏是重新编排，不是把桌面版压扁）。作品少于 6 部改「近景星群」排布，0 部是空态 +「去创作」，不是一个空球。 |
| `/works` 作品馆 | `GET /stories?limit=100`，搜索 / 题材 / 排序 / 分页**全部前端做**。题材由在架作品的 `tags[0]` 派生。用 `meta.total` 判断有没有被截断，**有就如实说**。⚠️ 设计稿的「含隐藏属性」筛选**没做也不该做**：`sanitizeWorldConfig` 对非作者整条删键，能筛出来就等于泄露存在性。 |
| `/story/[storyId]` | 作品详情。与星系浮层**共用 `components/works/WorkDetail`**（浮层与整页同一份内容契约，不写两套）——独立页是给深链、分享、`/login?next=` 回跳用的。含世界观 / 登场人物 / 属性三态 / 数据 / 生成设置（`StoryLLMConfigPanel`）/「走进这个世界」。**作者本人另有「编辑这部作品」**（`user.id === story.creator_id`）——后端 `StoryService.Update` 只校验属主、不看状态，一直支持已发布作品的编辑，缺的只是入口。 |
| `/play/[sessionId]` | 游玩页。三栏舞台（左 `AttrBar` 状态轨 + 中正文 + 右旅程轨）+ 悬浮控制条（遮罩浓度 / 字号 / 行距 / 天空漂移）+ 底部选项坞（编号选项 + **1/2/3 快捷键** + 自由输入）+ 世界星图浮层（`StoryTree`，横向航迹：深度走 x、分叉走 y，层距按视口宽自适应）。正文衬线逐字流式（**无首字下沉**）。⚠️ 星图上点航点**只是查看**，回溯要另按「回到这里重新选择」——两者分开；但回溯本身**不删数据**（见下方数据流）。 |
| `/create`·`/edit/[storyId]` | 六段式创作编辑器：左 44% sticky 天空（**天空即完成度**，六段各点亮一层）+ 右段落轨与面板（`components/editor/` 六段面板）。段落**可任意跳转**，没有顺序门禁。段 5 = 15 预设色块 + 自由色相条 + 6 个姿态。 |
| `/login` | L0–L5 天空阶梯：邮箱输入逐层点亮世界。`maxLevel` 单向不倒退。登录/注册 tab 共用同一套阶梯。提交成功会写开屏已看时间戳，紧接着进星海不重播 2.6s 开屏（同一件事说两遍）。 |
| `/mine` | 我的空间（本人视角）。作者天空（N 部作品各一层 `mix-blend-mode: screen`）+ 资料 + 数字。数字只列**有写入路径**的三项（已发布 / 累计游玩 / 收到的赞）——摆一个恒为 0 的「粉丝」只会被读成「没人关注你」。**作品列表不在这里**：整块搬去 `/mine/works`，同一份列表画两遍，改一处必漏另一处。 |
| `/mine/works` | 我的作品（`GET /stories/mine` 全量）。**由原草稿箱页与 `/mine` 的作品栏合并**，按「全部 / 已发布 / 草稿」筛选，缩略天空右上角带状态角标。**两类动作相同：编辑 + 试玩**——发布不是终点，只给草稿留编辑入口等于逼作者先下架再改。试玩**有存档就续、没有才开新局**（作者调稿会反复点，每次开新局会在历史里堆一串一步没走的空局）。缩略天空**只画已点亮的层**（层与编辑器六段同源，**重算而不是存进度字段**——存字段就有两份真相），草稿另用文字说明缺哪几段。 |
| `/mine/history` | 阅读历史（`GET /play/sessions`）。缩略天空里**只有走完的世界才划流星**；作品被收回的那几行压暗但不隐藏。⚠️ 一处有意的近似：该接口不返 `world_config`，所以缩略天空的色相由 `story_id` 哈希派生——同一部作品永远同一个颜色，但**不等于作品真正的主题色**。要精确得让后端在列表里带上 `theme`；为每行再拉一次 `/stories/:id` 是 N+1，只为一枚缩略图不值。 |
| `/mine/settings` | 资料（`PUT /auth/profile`）+ AI 连接（`LLMSettings`，真实 BYOK CRUD）+ 阅读偏好（减动效 / 遮罩浓度）+ 退出登录。改密码没有接口，所以**不放一个点了没反应的入口**。 |
| `/community`·`/mine/inbox` | **开发中占位**（共用 `components/wx/Soon.tsx`）：有入口、**零假数据**，并把「已经能用的那部分」单列出来（社区那页写明点赞已落地）。不造假的分叉事件流、假消息列表、假计数。 |
| `/admin` | 平台 LLM 设置（分环节连接 + 单价）。需 admin 角色。 |
| `not-found` | 纯静态，零后端依赖。⚠️ 环境色相锁死 252，不接 `useAmbientHue`。 |

## 目录结构

```
frontend/
├── src/                           # 全部源码（@/ 别名指向这里）
│   ├── app/
│   │   ├── layout.tsx             # 全局壳（next/font 注入 Inter + Noto Serif SC）
│   │   ├── globals.css            # 全站唯一全局表：token + reset + 共享组件层 + wx-* 关键帧
│   │   ├── page.tsx / page.module.css # 星海（3D 星系）
│   │   ├── error.tsx                 # 全局错误边界（运行时兜底，克制版）
│   │   ├── works | login | community | admin | create | edit | story | play | mine/*
│   │   └── not-found.tsx          # 404
│   ├── lib/
│   │   ├── api.ts                 # fetch 封装（解 {success,data,error,meta} 信封）+ postStream + 401 集中处理
│   │   ├── hue.ts                 # resolveTheme 三级解析 + 15 套预设（仅供选色器）
│   │   ├── prng.ts                # 定种子线性同余。**全站禁 Math.random()**
│   │   ├── types.ts               # 后端 DTO 类型 + GENRES
│   │   ├── state.ts               # JSON 字符串字段解析 + buildPath 重建当前路径
│   │   ├── tree.ts                # 航迹布局（buildChildrenMap / layoutTree，横轴=深度）
│   │   ├── intro.ts               # 开屏「播不播」的唯一判定（时间戳 + 6h TTL）
│   │   ├── readerPrefs.ts         # 阅读偏好持久化（减动效 / 遮罩浓度）
│   │   └── work.ts / imageResize.ts / useReducedMotion.ts
│   ├── store/                     # playStore / editorStore / authStore
│   └── components/
│       ├── ui/                    # 无业务语义的通用件：Dialog / Dropdown / Switch / Toast /
│       │                              OptionList / ImageUpload / WanxiangLogo / icons / PrefsBoot
│       ├── sky/                    # WorldScope（挂 --hue）/ Sky（分层天空）/ Figure（六姿态剪影）/ Backdrop
│       ├── wx/                     # WxHeader（主导航 3 项）/ AccountMenu（头像下拉·个人向入口都在这）
│       │                              # SubNav / WorkFace / Soon
│       ├── editor/                 # StoryEditor 外壳 + 六段面板（SegInspiration / SegWorldview /
│       │                              # SegAttributes / SegOpening / SegSky / SegPublish）
│       │                              # + AttrTable / CharacterList / EditorSky
│       ├── llm/                    # LLM 配置三件：LLMSettings / AssistModelSettings / StoryLLMConfigPanel
│       ├── play/                   # 游玩页私有：AttrBar / StoryPane / StoryTree
│       └── works/                  # WorkDetail（星系浮层与详情页共用的同一份内容契约）
```

## 组件放哪

按顺序判定，先命中先归属：

1. **无业务语义**（换个项目也能用）→ `ui/`。
2. **只有一条业务流程在用**（创作编辑器 / 游玩 / 作品展示）→ 对应模块私有目录 `editor/`、`play/`、`works/`。
3. **跨模块的 LLM 配置面板** → `llm/`；**全站视觉系统**（天空/剪影/色相作用域）→ `sky/`；**布局壳**（顶栏/子导航）→ `wx/`。这三者是共享层，任何模块都可以 import。

复用规则：**只有 2 个消费者时先各写一份，第 3 个消费者出现再提取进共享层**——过早提取的抽象比重复更贵。

以上边界由 ESLint 强制（`.eslintrc.json` 的 `overrides`）：`ui/` 禁止 import 任何业务/模块目录；`editor/`、`play/`、`works/` 两两互斥。


## 与后端契约的要点

- 响应信封统一为 `{ success, data, error, meta }`。`lib/api.ts` 的 `api.get` 只返回 `data`；需要 `meta.total` 的地方走**并列**的 `api.getWithMeta`——不改 `request()` 的返回类型，那会波及全部调用点。
- **流式**：开局与续写都走 `postStream`（SSE）。`delta` 帧累积到 `store.streamingText`（`StoryPane` 逐字显示 + 光标），`revise` 帧清空重来，`done` 帧携带持久化后的 `SessionResult`。⚠️ **SSE 路由的错误状态码是 200**——`sseStart` 在调 service 前就提交了响应头，所以下架只读之类的错误是以 `event: error` 帧送出的，前端读 `detail`；只有 `backtrack` 这类普通 JSON 路由才真返 403。
- ⚠️ **`world_config` 在 API 入参里是 JSON 字符串，不是对象**（`service.StoryCreateInput.WorldConfig` 是 `string`）。传对象会被 400 挡回；读出来同样是字符串，要 `JSON.parse`。已实测踩过。
- `current_state`、`suggested_options`、`state_snapshot`、`revealed_attrs` 后端以 **JSON 字符串** 返回，需经 `lib/state.ts` 解析后使用。
- **属性可见性**（`AttrBar`）：显示某属性当且仅当 `非 hidden ∧（非 reveal 门控 ∨ 已在 session.revealed_attrs 揭示）`。后端已在服务端脱敏（`hidden` 与未揭示的 `reveal` 数值根本不下发），前端这层是一致性而非安全边界。语义详见交接手册 §5.3。
- 续玩时后端只返回全部节点与 `current_node_id`；`store` 常驻这份 `allNodes`，`lib/tree.ts` 的 `layoutTree()` 用 `parent_id` 建成星图——回溯不删数据，被放弃的分支也在图上（变暗）。当前路径由 `buildPath()` 沿 `parent_id` 回溯并高亮。
- **横轴是显示列，不是 `depth`。** 连续的「继续」翻页（AI 没给选项时 `OptionList` 只有一个继续按钮，提交字面量 `"继续"`）会被 `collectRun()` 折成一颗星，标「继续 ×N」，两侧带小点。它们不是决策点，各占一列等于用横轴长度表达「翻了几页」。**开局、当前所在、结局、真实选择一律不折叠**；末节点的分叉照常从折叠星上挂出去，结构不丢。点折叠星是**展开**而非检视（星图兼着回溯入口，直接吞掉会让玩家没法回到翻页途中用自由输入岔出去）；`expanded` 存段内每个节点 id，抽屉一关就清空。
- `choose()` 把返回的 `current_node` **按 id 去重后**并入 `allNodes`：后端可能复用既有节点而不新建（逐字相同的选择在生成前就走既有分支，近义选择在生成后语义去重），无脑追加会让星图冒出一个重复分支。此时 SSE 只有 `done` 帧、没有 `delta`，正文瞬间出现而非逐字——这是正确表现，不是卡住。
