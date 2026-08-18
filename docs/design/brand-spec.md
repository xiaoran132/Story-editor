# 《万象》品牌规格

本文件是 token 的一页摘要,给快速取值用。三份文档的分工:

- **方向问题**(为什么这样做)—— `wanxiang-design-brief.md`
- **实现问题**(是什么、在哪、多少)—— `DESIGN.md`,含逐页实现与变更记录
- 本文件与 `DESIGN.md` 的 token 表不一致时,**以 `DESIGN.md` 为准**并回填这里

```css
:root {
  --bg: oklch(0.13 0.022 265);
  --surface: oklch(0.19 0.030 265);
  --fg: oklch(0.96 0.010 90);
  --muted: oklch(0.72 0.020 265);
  --border: oklch(1 0 0 / 0.11);
  --accent: oklch(0.82 0.125 85);
  --font-display: "Noto Serif SC", "Songti SC", serif;
  --font-ui: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "SFMono-Regular", Consolas, monospace;
}
```

- 底色为深空墨底,近黑但不纯黑。白底已被明确否决——深底是让作品缤纷色发光的物理前提。
- 每部作品一个 `--hue` (0–360) 驱动整套配色,派生出 `--w-*` 角色 token;每个 token 的 L 与 C 写死,只有 H 跟着变。
- 标题用 Noto Serif SC,UI 与正文用 Inter;CJK 标题行高不低于 1.3、`letter-spacing: 0`,不加负字距。
- 全站唯一强调色为暖金 `--accent`,每屏最多出现 2 处,且不参与 hue 染色。
- 派生色一律用 `oklch()`,不新造 hex;交互态前景对比度不得低于默认态,每个可聚焦元素都要有可见的 `:focus-visible` 焦点环。

> ⚠️ 角色 token 必须声明在使用它的元素上(如 `.work` / `.scene`),不能放 `:root`。
> CSS 自定义属性在声明处就完成 `var()` 替换,放 `:root` 会被永久锁死成根 hue,每张卡就都同一个色了。
