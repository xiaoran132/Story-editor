# 《万象》设计方向 · 交接简报

> 新对话请先读这份。它记录了已锁定的决策,避免重新讨论。
> 生成于 2026-08-13,承接一次完整的方向重定。

---

## 0. 一句话

**产品不是装作品的白盒子,产品就是那片由想象力构成的星空本身。**
Story Editor(代号《万象》)是 AI 互动剧情共创社区:一个灵感 → AI 不断衍生 → 人人都能把想象中的世界展示出来。

代码仓库:`D:\Story-editor`(Go + Next.js + Python FastAPI；`README.md` / `CLAUDE.md` 位于外部代码仓库，不随当前设计文件交付包复制。)

---

## 1. ⚠️ 作废的旧方向(重要)

项目记忆里可能仍存着一条 **「Product:白底 #ffffff / 强调 #1677ff / Inter / 8px 圆角」** 的视觉方向 —— **已作废**。

用户明确否定的理由:「白色是不犯错的颜色,但却是最普通的颜色」。
若记忆与本文件冲突,**以本文件为准**;建议直接更新该条设计记忆。

---

## 2. 已锁定的视觉语言:剪影 × 天空

| 要素 | 决策 |
|---|---|
| **底色** | 深空墨底,近黑不纯黑。这是让缤纷色彩发光的**物理前提**——白底会稀释所有作品色 |
| **角色** | 一条 SVG 黑色剪影,**零细节**,姿态即性格。零版权、零素材依赖 |
| **世界** | 渐变天空 + 云 + 星点 + 流星,全部 CSS/SVG 生成 |
| **构图** | **人小,世界大**(人物占比 <15%)——这就是「人站在自己想象出的浩瀚面前」 |
| **色彩** | 每部作品一个 `hue 0–360`,驱动整套配色 |
| **强调色** | 全站唯一暖金 `oklch(0.82 0.125 85)`,**不参与 hue 染色**,每屏 ≤2 处 |
| **字体** | 标题 Noto Serif SC / UI 正文 Inter。CJK 标题行高 ≥1.3、不加负字距 |

### 结论的来源(不要推翻重来)
`refs/` 里下载的参考图中,最打动人的两张(`04-anime-sil-darksky`、`07-bw-figure-stars`)角色**都是纯黑剪影**,全部表现力在天空;而扁平矢量人物(`01`)反而最有模板感。
→ 所以「SVG 剪影」不是没预算的妥协,**那些好参考本来就是这么做的**。
`refs/` 图片仅作风格参考,**一张都不进产品**。

---

## 3. hue 系统(技术核心,取自 Mizuki 的纪律)

**规则:每个角色 token 的 L 和 C 写死,只有 H 用 `var(--hue)`。** 这样换色相时明度/饱和层级不会崩。

```css
.world-scope{
  --w-line:   oklch(0.72 0.140 var(--hue) / .85);
  --w-glow:   oklch(0.72 0.140 var(--hue) / .50);
  --w-sky-hi: oklch(0.34 0.115 var(--hue));
  --w-sky-md: oklch(0.22 0.085 var(--hue));
  --w-sky-lo: oklch(0.11 0.040 var(--hue));
  --w-halo:   oklch(0.48 0.130 var(--hue) / .75);
  --w-cloud:  oklch(0.20 0.050 var(--hue) / .85);
  --w-star:   oklch(0.98 0.020 var(--hue) / .90);
  --w-ink:    oklch(0.055 0.015 var(--hue));   /* 剪影色 */
  --w-plate:  oklch(0.050 0.015 var(--hue) / .92);
  --w-text:   oklch(0.97 0.010 var(--hue));
  --w-kick:   oklch(0.86 0.090 var(--hue));
}
```

**⚠️ 关键陷阱:这组 token 必须声明在使用它的元素上(如 `.work`),不能放 `:root`。**
CSS 自定义属性在**声明处**就完成 `var()` 替换,放 `:root` 会被永久锁死成根 hue,每张卡就都同一个色了。

**环境染色**:`:root` 上另有 `--ambient-hue`,驱动整片深空背景。点开某作品时过渡到它的 hue(1.1s),退出回落 252 —— 兑现「翻十部作品 = 穿过十个宇宙」。UI 暖金强调色**不跟着变**。

---

## 4. 已交付

**页面与共享作品数据** —— `assets/works-data.js` + 作品馆、星海、社区、星图、阅读、个人空间与游玩页

- **开屏**:黑屏一个光点(灵感)→ 分叉 2/4/8 条(剧情树生长,复用分支 logo 语义)→ 末端亮成星 → 星群散开 → 12 张作品卡错峰浮现。约 2.6s,可跳过,`prefers-reduced-motion` 下直接呈现。
- **3D 星系**:纯 CSS `transform-style: preserve-3d`,**无 Three.js/WebGL**。四种排布可切:**星系(斐波那契球) / 银河(螺旋) / 书架(网格) / 混沌(随机)**。拖拽旋转、滚轮远近、惯性缓动(`v += (target-v)*0.08`)。
- **卡片**:一片 hue 天空 + 剪影 + 作品名。悬停亮描边+辉光。
- **聚焦**:点击 → 星系转向该作品 + 整体虚化后退 → 大卡与详情面板浮出(世界观、属性含隐藏/渐显、数据、「走进这个世界」CTA)。Esc / 点空白退出。
- 剪影有 6 种姿态:`gaze / radio / blade / umbrella / reach / walk`,由 `figure(type)` 生成。

## 5. 待办

1. **接后端数据**：目前 12 部作品、节点树、消息和历史仍为静态演示。接入 `/api/v1/stories` 时，以 `assets/works-data.js` 的字段与路由键为迁移契约。
2. **扩展游玩能力**：当前只有 `radio` 有可游玩剧情；其他世界先展示自己的衍生星图，不伪造阅读入口。
3. **规模化策略**：作品超过 12 部后，决定按题材分星团、虚拟化或分页的组合。

---

## 6. 硬纪律(别丢)

- 强调色唯一,每屏 ≤2 处;染色只染氛围,不染 UI 强调色。
- CJK 标题行高 ≥1.3、`letter-spacing: 0`;正文禁 `text-align: justify`。
- 交互态前景对比度**不得低于**默认态;`:focus-visible` 必须有可见焦点环。
- 位移/缩放/循环动效一律尊重 `prefers-reduced-motion`。
- 再炫也不牺牲「读得下去」——阅读态正文守遮罩护栏与 AA 对比度。
- 动效落位:**外壳静止,动感长在作品上,且借作品自身主题色**。
- 图标一律 1.6–2px 单线 SVG + `currentColor`,**禁用 emoji 当图标**。
- 同一动作全站只有一个实心主 CTA。

---

## 7. 作品数据契约（唯一身份源）

`assets/works-data.js` 维护 12 部作品的唯一身份数据，对外提供 `WANXIANG_WORKS`、`WANXIANG_WORK(key)` 与 `WANXIANG_WORK_LINK(work)`。页面只可在本页维护节点、历史、消息等衍生演示数据，不可复制作品名称、题材、hue、剪影、封面、属性和统计字段。

| 字段 | 含义 | 示例 |
|---|---|---|
| `key` | 稳定路由键 | `radio` |
| `playable` | 是否有真实游玩剧情 | `true` |
| `n` / `k` | 作品名 / 题材 | `最后的深夜电台` / `末世 · 电台` |
| `h` / `f` | hue / 剪影姿态 | `252` / `radio` |
| `cover` / `coverStyle` | 本地封面与来源说明 | `assets/covers/web-pixel-landscape.png` |
| `t` / `w` / `a` / `p` / `l` | 内容、属性与展示数据 | 见共享数据 |

**诚实路由**：`radio` → `play-story.html?world=radio`；其他作品 → `derivation-graph.html?world=<key>`。不要把尚未有剧情的世界跳进《最后的深夜电台》。

**属性系统对应后端**(见 `D:\Story-editor`)：类型 `number`(累加) / `scalar`(覆盖) / `set`(增删)；`hidden` = 仅 AI 可见、玩家永不显示；`reveal` = 剧情揭示后才显示。UI 必须体现这三态区别。

## 8. 剪影 API

`figure(type)` 返回 SVG 字符串,`viewBox="0 0 100 92"`,`fill/stroke: currentColor`(由 `--w-ink` 着色)。
结构 = 头(circle)+ 躯干(path)+ 四肢(stroke path,`stroke-linecap:round`)。

六种姿态:`gaze`(仰望)· `radio`(举对讲机)· `blade`(按刀)· `umbrella`(撑伞)· `reach`(张臂)· `walk`(行走)。
新增姿态只需改四肢的 stroke path,躯干复用。

## 9. 3D 星系实现要点(纯 CSS,无 3D 引擎)

- `.stage{perspective:1250px}` → `.orbit{transform-style:preserve-3d}` → 卡片 `translate3d + rotateY + rotateX`。
- 四种布局各是一个纯函数返回 `{x,y,z,ry,rx}[]`:
  - **球体**:斐波那契球,R=400,`ry=atan2(x,z)`、`rx=asin(y/R)*0.7` 使卡片朝外。
  - **螺旋**:每张转 32°,R=330,y 逐层 +52。
  - **网格**:4 列,间距 214×268。
  - **混沌**:线性同余伪随机(种子 9301,**保证每次刷新一致**)。
- 卡片 `backface-visibility:hidden` —— 背面卡自动隐藏,只见前壳,避免镜像文字。
- 旋转用缓动逼近而非直接赋值:`v += (target - v) * 0.075`,拖拽/自转/聚焦共用同一套。
- `will-change:transform,opacity`,动画结束后置回 `auto`(取自 Mizuki,避免长期占用合成层)。

## 10. 交互参数

| 参数 | 值 |
|---|---|
| 缓动 | `cubic-bezier(.2,0,0,1)`(M3 standard) |
| 按下 / 状态确认 / 浮层进入 / 跨屏 | 90ms / 150ms / 220ms / 320ms |
| 卡片排布切换 | 1.05s,错峰 38ms |
| 卡片入场淡入 | 620ms,错峰 42ms,由开屏结束触发 |
| 环境色相过渡 | 1.1s |
| 开屏总时长 | ≈2.6s,可跳过 |
| 自转速度 | 每帧 +0.055° |

## 11. 验收清单(每屏交付前逐条过)

**视觉方向**
- [ ] 深空墨底,非纯黑;白底一律视为跑偏
- [ ] 每部作品的 `--hue` 真实驱动配色,不是手调的固定色
- [ ] 人物剪影为纯黑无细节,占画面 <15%(人小,世界大)
- [ ] 全站只有一个强调色(暖金),每屏出现 ≤2 次,且**不参与 hue 染色**

**排版**
- [ ] CJK 标题行高 ≥1.3、`letter-spacing: 0`
- [ ] 正文无 `text-align: justify`
- [ ] 标题用 Noto Serif SC,UI/正文用 Inter,两族分工不混

**颜色与 token**
- [ ] 角色 token 声明在**使用它的元素**上,不在 `:root`(否则每张卡同色)
- [ ] 派生色一律 `oklch()`,不新造 hex
- [ ] 每个角色 token 的 L / C 固定,只有 H 变

**交互态**
- [ ] hover 改背景/描边/阴影,**绝不**把前景改暗或改成 muted
- [ ] 每个可聚焦元素有可见 `:focus-visible` 环
- [ ] 浮层可 Esc 关闭,关闭后焦点回到触发元素

**无障碍**
- [ ] `prefers-reduced-motion` 下无位移/缩放/循环动画
- [ ] 正文对比度 ≥4.5:1;阅读态遮罩浓度 ≥0.52
- [ ] 图标按钮有 `aria-label`,装饰图标 `aria-hidden`

**响应式**
- [ ] 360 / 768 / 1024 / 1440px 均无横向滚动
- [ ] 小屏是重新编排,不是把桌面版压扁

## 12. 开放问题与已知缺陷（待决策）

**已解决**
- [x] 顶栏、作品卡和个人页不再指向缺失页面；历史、消息与星图入口按共享 `key` 路由。
- [x] 3D 星系在小屏降级为 2D 天空墙；开屏只在首次进入时播放。
- [x] 已清理运行页未引用的检索中间产物、候选封面和风格参考图；`.file-versions/` 与历史 `*.artifact.json` 仅用于版本追溯，保留不删。

**待决策**
- [ ] **规模化**：12 部作品适合当前结构；真实上线后上百部作品的星团、虚拟化与分页策略待定。
- [ ] **游玩页「世界活着」的强度**：场景漂移与选择变色的具体参数仍可在真实内容接入后调校。
- [ ] **作品数据来源**：何时以 `/api/v1/stories` 取代静态演示数据？字段映射见 §7。

## 13. 参考来源(决策出处)

### A. 本地代码参考

**1. Mizuki** — `C:\Users\13192\Downloads\Mizuki`
GitHub: https://github.com/LyraVoid/Mizuki (Astro 博客主题)

- **取用**:`src/styles/variables.styl` 的 **hue 纪律** —— 每个角色 token 的 L / C 写死,只有 H 用 `var(--hue)`(见 §3,本项目的技术核心);`--wallpaper-opacity` / `--card-transparent-opacity` 的壁纸透明架构(启发了阅读态遮罩 + 自传背景);动画结束后释放 `will-change`。
- **差异**:Mizuki 是**站点级单一 hue**(`:root` 一个值);本项目改成**每张卡各自 hue**,因此 token 必须声明在卡片元素上而非 `:root`(§3 的陷阱即源于此)。
- 其他可看:`src/styles/animation-enhancements.css`、`transition.css`、`banner.css`。

**2. the118-pTable** — `C:\Users\13192\Downloads\the118-pTable-main\the118-pTable-main`
(化学元素周期表 3D 可视化,React + Vite)

- **取用**:`LayoutStyle` 的**五种空间排布**(TAB 表格 / SPH 球体 / HEL 螺旋 / GRI 网格 / RAN 随机)→ 本项目的四种星系排布;**纯 CSS `matrix3d`,无 Three.js / WebGL**(证明了 3D 星系可行且轻量);`calcCardsWrapMatrix3d()` 的「选中即推到眼前」思路;`ThemeService.applyThemeToDom()` 运行时把 camelCase 主题对象注入成 CSS 变量。
- **关键文件**:`src/domain/typings/viewModels.ts`(布局枚举)、`src/domain/viewModels/implementations/GriViewModel.ts`(矩阵算法范例)、`src/domain/services/ThemeService.ts`、`src/domain/theme/config.json`。

### B. 参考网站(氛围与叙事方向)

| 网址 | 取用点 |
|---|---|
| https://cyclemon.com/ | **角色方向的主要启发** —— 插画角色 + 分章滚动叙事 |
| https://www.bienvillecapital.com/vision | 滚动叙事结构、海报级大字排版、马赛克影像 |
| https://toolofna.com/ | 影像驱动的开屏与转场 |
| http://whiteboard.is/ | 实验性交互 |
| https://minimalmonkey.com/ | 克制的个人站编排 |
| https://mengto.com/ | 设计师个人站参考 |

### C. ⚠️ 抓取限制(别浪费时间重试)

这些在本环境**实测失败**,新对话不必重复尝试:

- **WebFetch 会把页面转成纯文本,CSS 与图片全被剥离** —— 拿不到参考站的真实色值 / 字体 / 动效参数。想要真实视觉只能:用户截图、启用 Screenshot MCP、或用户粘贴 CSS。
- `raw.githubusercontent.com` **全部 404**(该环境不可达);GitHub tree / 目录页 404;GitHub API **403 限流**。唯一可读的是 GitHub 仓库首页(README 渲染版)。
- **可行的取图路径**:从搜索结果页拿到图片直链 → PowerShell `Invoke-WebRequest` 下载到本地 → 用 Read 工具看图；验证完成后应清除不进入产品的临时参考图。
- OD `media generate`(fal 图像生成)在本环境**无返回**,已改用 hue 驱动的 CSS 天空。

### D. 已清理的本地参考图

`refs/` 中的图片仅用于早期方向判断，未进入产品；其结论（深空底、人物极小的纯黑剪影、由天空承担情绪）已经写入 §2。为避免把不可商用的参考素材误带入交付，2026-08-18 已从项目中删除这些本地图片，不再作为运行依赖。

## 14. 新对话怎么起手

> 先读 `wanxiang-design-brief.md` 与 `DESIGN.md`，按锁定的《万象》方向继续；再检查要修改页面是否已加载 `assets/works-data.js`。

打开 `home-galaxy.html` 可直接复用:`.world-scope` token 组、`figure()` 剪影、`skyHTML()` 天空生成、星点生成、开屏 SVG。**不要重新发明这些。**
