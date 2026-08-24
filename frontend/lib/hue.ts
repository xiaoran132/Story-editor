// 作品主题 → {hue, figure}。新设计体系里每部作品一个 --hue(0–360)，
// 驱动 .world-scope 那整套 oklch 派生色（DESIGN.md §4）。
//
// **存储格式是值，不是 id。** world_config.theme 直接存 {hue, figure}：
// 预设若只是前端常量，改动 ink 的色相会让所有用它的作品一起变色；
// 值固化进作品后，颜色是作品身份的一部分，不会在作者背后漂移。
// 预设降级为选色器的便利项——选了预设也写成 object，不写 id。
//
// 库里两种形态长期并存（实测：12 部里 7 部字符串 id、5 部对象），
// 所以 resolveTheme 必须同时吃，这不是待清理的历史包袱，是长期契约。

import { hashSeed } from "./prng";

export type FigurePose = "gaze" | "radio" | "blade" | "umbrella" | "reach" | "walk";

export type Theme = { hue: number; figure: FigurePose };

export type ThemePreset = Theme & { id: string; label: string };

export const FIGURE_POSES: FigurePose[] = ["gaze", "radio", "blade", "umbrella", "reach", "walk"];

/** 兜底主题：登录页与 not-found 用的中性色相，也是 --ambient-hue 的回落值。 */
export const DEFAULT_THEME: Theme = { hue: 252, figure: "gaze" };

// 15 套预设。**只服务选色器**，不是存储格式。
//
// 原 8 套的色相全挤在 96–252 的冷色区（6 套），0–90 的红橙琥珀整段空白、
// 268–310 也是空的；星系把所有作品的天空并排铺开，这个偏斜会直接看出来。
// 补的 7 套尽量取已在交付页面或库里验证过的 hue，不新造。
// 相邻最小间距 14°（radio/star 那对是原有的），其余 ≥16°——固定 L/C 下
// 16° 以上才读得出是两个色系。
//
// ⚠️ star 的标签是「星海」不是「星海 · 默认」：叫默认就是在告诉作者
// 「不用管这个」，它会吃掉大部分作品，星系就又变回单色了。
export const THEME_PRESETS: ThemePreset[] = [
  { id: "loop", label: "无限流 · 轮回", hue: 6, figure: "walk" },
  { id: "republic", label: "民国 · 怪谈", hue: 22, figure: "umbrella" },
  { id: "waste", label: "废土 · 机械", hue: 44, figure: "reach" },
  { id: "ascend", label: "仙侠 · 飞升", hue: 70, figure: "blade" },
  { id: "horror", label: "怪谈 · 恐怖", hue: 96, figure: "walk" },
  { id: "summer", label: "夏日 · 奇谭", hue: 114, figure: "walk" },
  { id: "heal", label: "治愈 · 日常", hue: 132, figure: "reach" },
  { id: "xian", label: "仙侠 · 武侠", hue: 168, figure: "blade" },
  { id: "ink", label: "古典 · 水墨", hue: 196, figure: "umbrella" },
  { id: "abyss", label: "克苏鲁 · 邪神", hue: 212, figure: "gaze" },
  { id: "radio", label: "末世 · 电台", hue: 238, figure: "radio" },
  { id: "star", label: "星海", hue: 252, figure: "gaze" },
  { id: "system", label: "系统流 · 面板", hue: 288, figure: "reach" },
  { id: "sci", label: "科幻 · 赛博", hue: 312, figure: "walk" },
  { id: "love", label: "恋爱 · 青春", hue: 340, figure: "gaze" },
];

export function findPreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((p) => p.id === id);
}

// hue 落在 [0, 360)。作者可以自由拖色相条，越界与非数字都要能收住，
// 否则 oklch() 拿到 NaN 会让整块天空回退成透明。
function normalizeHue(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return ((n % 360) + 360) % 360;
}

function normalizeFigure(value: unknown): FigurePose | null {
  return typeof value === "string" && (FIGURE_POSES as string[]).includes(value)
    ? (value as FigurePose)
    : null;
}

/**
 * 三级解析：
 *   ① object {hue, figure} —— 直接用（当前写入格式）
 *   ② 字符串预设 id —— 查表（库里 7 部老数据）
 *   ③ 都没有 —— 用 storyId 哈希派生 hue，姿态默认 gaze
 *
 * 第三级只服务缺 theme 的数据：给它一个稳定且分散的颜色，
 * 好过全部落到同一个默认色让星系变单色。
 *
 * worldConfig 两种入参都收：API 里它是 **JSON 字符串**不是对象
 * （service.StoryCreateInput.WorldConfig 是 string），读出来同样要 JSON.parse。
 */
export function resolveTheme(
  worldConfig: string | Record<string, unknown> | null | undefined,
  storyId?: string,
): Theme {
  let parsed: Record<string, unknown> = {};
  if (typeof worldConfig === "string") {
    try {
      parsed = JSON.parse(worldConfig || "{}") as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  } else if (worldConfig && typeof worldConfig === "object") {
    parsed = worldConfig;
  }

  const theme = parsed.theme;

  // ① 对象形态
  if (theme && typeof theme === "object" && !Array.isArray(theme)) {
    const t = theme as Record<string, unknown>;
    const hue = normalizeHue(t.hue);
    if (hue !== null) {
      return { hue, figure: normalizeFigure(t.figure) ?? DEFAULT_THEME.figure };
    }
  }

  // ② 字符串预设 id
  if (typeof theme === "string") {
    const preset = findPreset(theme);
    if (preset) return { hue: preset.hue, figure: preset.figure };
  }

  // ③ storyId 哈希兜底
  if (storyId) {
    return { hue: hashSeed(storyId) % 360, figure: DEFAULT_THEME.figure };
  }
  return { ...DEFAULT_THEME };
}
