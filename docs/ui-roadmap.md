# UI 规划（已实现，2026-08-05）

> **状态：A（BYOK 界面一致性）P0/P1/P2 + B（作品级主题换肤 v1，star/ink/horror 3 套）均已实现。**
> 换肤适用点较原规划**修正**：`data-theme` 挂在 `<html>`（非 `.wrap`），否则 body 星云背景不换肤。
> 落地细节见 `docs/handoff.md §13`。以下为原始规划，存档备查。
>
> 本文件是两条 UI 工作线的执行规划：**A. BYOK 界面一致性修复**、**B. 作品级主题换肤**。
> 均为在既有「星图」设计体系上的**演进**，不推倒重来。开发前先读 `frontend/app/globals.css`
> 顶部的设计体系注释与本文件；完成后按 `handoff.md §10` 同步文档。

## 背景与已定方向

- 星图体系（深空藏蓝 + 冷蓝 `--glow` / 暖金 `--star` 双主色，签名件=发光剧情树）是**平台身份**，保留。
- 痛点：平台承载多风格作品，单一固定皮肤显单调、且与作品调性冲突。
- **已定方案（演进，非重来）**：
  - **平台外壳恒定**（首页 `/`、社区、个人主页 `/me`、编辑器、`/admin`）：维持星图，克制。
  - **作品级换肤**：主题是**作品的属性、由创作者在编辑器选**；玩家进入该作品的**详情页 + 游玩页**时整页换肤，离开恢复星图。剧情树跟随作品强调色重新着色。
  - 首页作品卡片按各自主题**微染色**（描边/角标），让"多风格"在首页就可见。
  - **玩家全局覆盖**（不管作者选什么、一律用我的皮肤）**推迟到 v2**，v1 不做，避免过早引入"作者意图 vs 玩家偏好"优先级问题。

---

## 工作线 A：BYOK 界面一致性修复

> 上一轮 BYOK 功能已入库（commit `e7c7414`），但新增面还没在 dev 过目，有几处与既有视觉家族"不同款"。建议与主题换肤一起在 dev 预览后提交。

### P0（一致性，低风险）
1. **作品详情页「本作品 AI 配置」标题不成体系** — 该页其余区块用 `<section class="detail-block"><h2>`（冷蓝 12px 宽字距，见 `globals.css` `.detail-block h2`）。当前面板用 muted 灰的 `.llm-panel-toggle` 按钮当标题，读作另一套。
   - 改：折叠标题沿用 `.detail-block h2` 的字色/字距（冷蓝 eyebrow 风）。文件：`components/StoryLLMConfigPanel.tsx` + `globals.css` `.llm-panel-toggle`。
2. **编辑器「④ 推荐模型」用多行 `<Textarea rows={1}>` 装单行模型名** — 会出现拖拽手柄/换行，语义不符。
   - 改：换单行 `.ed-input`（可给 `components/editor/` 加一个 `Input.tsx`，或就地用 `label.ed-field > input.ed-input`）。文件：`components/editor/StoryEditor.tsx`（`recWriteModel`/`recReviewModel` 两栏）。
3. **连接行供应商徽章显示机器值**（`deepseek`/`custom`）— 应映射成友好名。
   - 改：用 `lib/types.ts` 的 `LLM_PROVIDERS` label 显示。文件：`components/LLMSettings.tsx`（连接列表 `.badge`）。

### P1（窄列布局）
4. **`.llm-bind-row` 三列 `1.3fr 1fr 1fr` 在 820px 详情列偏挤**（标签+连接下拉+模型框并排）。
   - 改：标签独占一行，下面「连接 + 模型」两列并排；移动端已折单列（`@media max-width:640px`）。文件：`globals.css` `.llm-bind-row` + `StoryLLMConfigPanel.tsx` 结构。

### P2（可选）
5. **模型 `datalist` 无下拉提示** — 加一句 `ed-hint`「选连接后可下拉，也可手填」。文件：`StoryLLMConfigPanel.tsx`。

---

## 工作线 B：作品级主题换肤（v1）

### 数据
- 主题标识存进 **`world_config.theme`**（字符串 id），**零迁移**——与 `recommended_models` 同法透传（后端 `worldConfigShape` 用固定 struct 反序列化，未知键自动忽略；`ValidateWorldConfig` 不受影响）。
- `editorStore.ts`：`worldObject()` 写入 `theme`，`loadStory()` 解析回填；表单加 `theme` 字段（默认 `"star"`）。

### 令牌（CSS 变量）改造
- `globals.css` 现有 `:root` 那组变量即"默认主题(star)"。将其保留为默认，再加 `[data-theme="ink"] {…}`、`[data-theme="horror"] {…}` 等，每套只覆盖约 8–10 个变量：
  `--bg / --surface / --surface-2 / --ink / --muted / --line / --glow / --glow-soft / --star / --star-soft`（必要时 `--font-body`）。
- **注意 body 星云背景**：当前 `body { background: radial-gradient(...rgba(110,168,255)...), ... }` 用的是**硬编码 rgba**，不随变量走。为支持换肤：
  - 方案（推荐）：把两团星云色抽成变量 `--nebula-a/--nebula-b`，`body` 背景改用变量；各主题覆盖之。
  - 或：作品页在容器（如 `.play-*` / 详情 `.wrap`）上自带背景、盖住全局 body。
  - 全屏体验页优先"整页换肤"，故 **data-theme 挂在页面顶层容器**（`app/story/[storyId]/page.tsx` 的 `.wrap`、`app/play/[sessionId]/page.tsx` 的顶层容器），外壳页不加即维持默认。

### 预设（v1 先 3 套，跑通后扩到 6）
- `star` 深空星图（默认，现状）：`--bg #0a0e1a` `--glow #6ea8ff` `--star #f4c96b`。
- `ink` 民国墨色：暖墨深底 + 宣纸感，强调 朱砂红 / 墨；`--font-body` 可换更古典衬线。
- `horror` 血色恐怖：近黑冷底，强调 血红 / 惨白。
- （后续）`romance` 暖光恋爱（奶油/胭脂）、`cyber` 赛博霓虹（青紫）、`paper` 素纸本格（冷灰/靛蓝）。
- 具体色值为建议、可调；每套需自查对比度（正文 `--ink` on `--bg` ≥ 4.5:1）。

### 应用点 / 文件
- `globals.css`：token 抽默认主题 + `[data-theme]` 覆盖块 + body 星云变量化。
- `lib/types.ts`：`THEMES` 列表（`{ id, label, swatch: [c1,c2] }`）供编辑器选择器 + 卡片染色。
- `store/editorStore.ts`：`theme` 字段 round-trip。
- `components/editor/StoryEditor.tsx`：主题选择器（色块 swatch + 名称）。
- `app/story/[storyId]/page.tsx`、`app/play/[sessionId]/page.tsx`：顶层容器 `data-theme={world.theme || "star"}`。
- `components/StoryCard.tsx`：读作品 theme，卡片描边/角标用该主题强调色微染。
- 剧情树 `components/StoryTree.tsx` / 抽屉：已用 `--glow/--star`，换肤后自动变色——需**验证**深色对比与发光在各主题下仍清晰。

### 验证
- dev 逐个预设在**作品详情 + 游玩**页人眼过目；确认**外壳页（首页/`/me`/编辑器/`/admin`）不受影响**。
- 剧情树在每套主题下连线/当前星/脉冲仍清晰可辨。
- `npx tsc --noEmit` + `npx next build` 绿。

---

## 建议顺序
先搭 **B 的主题基础设施 + 3 套预设 + 编辑器选择器**（端到端跑通、可预览），再把 **A 的 P0/P1 一致性修复**并进同一轮 dev 预览，一起提交。P2 顺带。
