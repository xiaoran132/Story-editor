# Story Editor · 设计交接规范(DESIGN.md)

> 目的:任何人 / 任何 AI 拿到这份 + `tokens.css`,新增页面也能**风格不跑偏**。
> 冲突时优先级:`tokens.css`(数值事实源) > 本文件(用法铁律) > `design-system.html`(人看的可视对照)。
> **第一条铁律:引用 token 变量,永远不要写死数值。**

---

## 1. 文件地图

| 文件 | 作用 | 态 |
|---|---|---|
| `tokens.css` | 全部设计变量的唯一事实源 | — |
| `DESIGN.md` | 本文件,可执行规则 + 交接 | — |
| `design-system.html` | 可视规范(颜色/字阶/组件/动效),人看对照 | 管理态 |
| `index.html` | 原型总览/启动台(非产品页) | 管理态 |
| `login.html` | 登录/注册(左氛围右表单) | 双态并置 |
| `home-discover.html` | 发现/书库 · 错落瀑布 | 管理态 |
| `story-detail.html` | 作品详情/开场过场 | 阅读态 |
| `play-reading.html` | 游玩 · 沉浸阅读 | 阅读态 |
| `my-space.html` | 我的空间(我的创作 + 我在读) | 管理态 |
| `settings.html` | 个人设置 / BYOK 连接 | 管理态 |
| `community.html` | 社区 feed | 管理态 |
| `create-editor.html` | 创作编辑器(AI 优先六步) | 管理态 |

---

## 2. 双态决策(先判态,再取 token)

**先问:这一屏是「读故事的沉浸体验」还是「用产品的功能界面」?**

- **阅读态**（`.od-reading`,暖深色 + 衬线 + 遮罩）：**仅** 游玩、作品详情、登录左栏。字是主角,chrome 隐形。
- **管理态**（默认 `:root`,白底 + Inter + 结构化）：**其余全部**。清晰、可扫。

> 新页面 99% 属管理态。只有「走进某个作品之后」的体验才用阅读态。

---

## 3. 颜色铁律

- **只用 `tokens.css` 里的变量**;每屏 `--accent` 可见使用 **≤ 2 处**(通常:一个 eyebrow/选中态 + 一个主 CTA)。
- 强调色做**小字/文字**时用 `--accent-ink`(#0b5fd0),不用 `--accent`(#1677ff 在白底约 3.6:1 不达 AA)。
- 管理态外壳**永远中性**;彩色只允许来自**作品主题色**(封面/阅读背景/主题选择器),且不得进入外壳。
- 语义色仅用于状态(成功/警告/危险/点赞),不做装饰。
- 对比度闸门:正文 ≥ 4.5:1,大字/图形 ≥ 3:1,焦点环 ≥ 3:1。
- **禁**:Tailwind indigo(#6366f1/#7c3aed/#8b5cf6/#a855f7…)、双色「信任」渐变做 hero、无功能的装饰渐变。

## 4. 排版铁律(CJK)

- 字体:UI/正文管理态用 `--font-sans`;中文标题与阅读态正文用 `--font-serif`。永不 `system-ui` 裸用于标题。
- **CJK 标题行高 ≥ 1.3**(1.3–1.4),**不加负字距**(`letter-spacing:0`)。负字距只给拉丁文。
- 正文行高:管理态 1.5–1.6;阅读态 CJK 1.85–1.9。
- **正文禁用 `text-align:justify`**(中文会出河流/参差)。
- 全大写(拉丁/标签)字距 ≥ .06em。三字重:400 读 / 510 强调 / 590 宣告,少用 700+。
- 单屏 ≤ 6 档字号。

## 5. 动效铁律

- 只用于**确认已发生的状态变化 / 空间与时间移动**,不为装饰。
- 非跨屏微交互 < 500ms;统一缓动 `var(--ease)`。
- **每页必带** `@media (prefers-reduced-motion: reduce)` 兜底(tokens.css 已给全局块,页面内若有额外动画需自行覆盖)。
- 循环动效(活封面/流动/骨架)> 5s 需可关;闪烁 ≤ 3 次/秒。
- **外壳静止,动感只长在内容(作品卡)上,且借作品自身主题色**——不给外壳穿统一动效风格。

## 6. 无障碍基线(WCAG 2.2 AA)

- 动作用 `<button>`,导航用 `<a href>`;不用裸 `<a>` 或 `<div onclick>` 冒充。
- 每输入有可见 `<label>`;错误用 `role="alert"` + `aria-invalid` + `aria-describedby`。
- 可见焦点环(`:focus-visible` + `--ring`),绝不 `outline:none` 无替代。
- 语义地标 `header/nav/main/aside/footer`;单一 `<h1>`,标题层级不跳级。
- 图标按钮加 `aria-label`;装饰图标 `aria-hidden`;单选组用 `aria-pressed`,Tab 用 `role=tab + aria-selected`。
- 触控目标 ≥ 24×24px。

## 7. 组件约定

- **按钮**:主(黑 `--fg`) > 强调(`--accent`,高信号动作) > 次级(描边) > 幽灵;危险用 `--danger`。每屏一个主按钮。齐 hover/active/focus/disabled。
- **卡片**:14px 圆角 + 细描边 + 静止投影 `box-shadow:var(--shadow-card)`;悬停上浮 4px 并换 `var(--shadow-card-hover)`。**不要**再把阴影字面量写进页面。
- **表单/开关/Chip/Badge/对话框/Toast**:见 `design-system.html` 实样,复制其结构与 token。
- **图标**:1.6–2px 单线 SVG + `currentColor`;**禁 emoji 当图标**。
- **状态三件套**:任何异步列表必须备**加载(骨架)/ 空 / 错误**三态;空/错误给明确出路。

## 8. 阅读态专项

- 正文坐在半透明**阅读遮罩**(`.scrim`)上,永不直接贴背景。
- 遮罩浓度可调,但**下限锁 `--scrim-alpha-min` .52**(低于则正文对比不达 AA)。
- 自主背景图:设 `--reader-bg: url(...)` 即接入,该层在场景之上、颗粒/暗角/遮罩之下,护栏自动生效。
- 暗面描边用半透明白 `--panel-border`,不用实色深边。

## 9. 加一个新页面的清单(照做即不跑偏)

1. `@import "tokens.css";` 放 `<style>` 顶部;判定态(§2),管理态直接用 `:root`,阅读态给根/容器加 `.od-reading`。
2. 只用变量;`--accent` ≤ 2 处;中文标题行高 ≥1.3 无负字距。
3. 顶部沿用统一 **header + 分支 logo**(见 tokens.css 底部 SVG)与导航集合:发现 / 我的空间 / 社区。
4. 交互元素用原生语义 + 焦点环 + aria;异步区备三态。
5. 收尾自查:对照 §3–§8 逐条过;跑 `design-system.html` 找对应组件抄结构。

---

## 10. 现状与待办

- **已知副本漂移**:11 个原型页目前各自在 `:root` 内联了一份 token(历史原因)。`tokens.css` 已是权威源;**下一步应把各页 `:root` 替换为 `@import "tokens.css";`**(逐页验证,勿一次性盲改)。新页面请直接 @import,不要再复制内联。
  - Next 实现侧(`frontend/app/globals.css`)的 token 层已与本文件对齐,新增变量一律**先回写 tokens.css 再落地**。已修掉的两处副本:品牌 glyph(曾在 AppHeader 与 login 各一份、颜色各写死一套,现为 `components/BrandGlyph.tsx` 单一来源 + currentColor)、sci 主题色值(CSS 与 `lib/types.ts` 两份,现已同步且不再用 Tailwind indigo)。
  - 仍存在的一份副本:作品主题色板同时存在于 tokens.css 注释、`globals.css` 的 `[data-work-theme]` 块、`lib/types.ts` 的 `THEMES`。前两者是阅读态场景色,后者是书库封面渐变,用途不同故未强行合并——改主题时三处都要看。
- 未做的产品页:管理后台(`/admin`,边缘)。
- 品牌:无正式 logo,现用「分支节点」占位标记(见 tokens.css 底部),可整体替换。
