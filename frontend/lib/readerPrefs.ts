"use client";

// 阅读偏好的持久化。**只管存取，不碰 DOM 主题**——「管理态 / 阅读态」那套模式切换
// 已随旧体系删除，全站恒定深空，没有可切换的态。
//
// 这里留下的两项都还有真实消费方：
//   · 遮罩浓度：游玩页与设置页共用同一个键，两页的滑杆调的是同一个偏好；
//   · 减少动效：系统级 prefers-reduced-motion 之外的用户级开关，写 <html data-motion="off">，
//     globals.css 侧有对应规则。PrefsBoot 在启动时把它套回 <html>。
//
// 正文字号 / 行距 / 天空漂移是游玩页独有的，存在它自己的 READER_PREFS_KEY 里，不进这里。

const MOTION_KEY = "reduce-motion"; // 玩家「减少动效」偏好
const SCRIM_KEY = "reading-scrim"; // 玩家遮罩浓度偏好（百分比整数），跨会话记忆

// 遮罩浓度的硬边界。⚠️ **百分比整数，不是 0–1 小数**——消费方要除以 100 再写进
// `--reader-veil`。低于下限，正文与身后的天空不足 4.5:1。
// ⚠️ 这个下限有**两处**表达：这里的 SCRIM_MIN，和游玩页/设置页那两个滑杆的 min 属性
// （两者都直接引用本常量，所以是引用不是复制）。改这里即可，别再往 CSS 里写第三份。
export const SCRIM_MIN = 52;
export const SCRIM_MAX = 92;
export const SCRIM_DEFAULT = 74;

const clampScrim = (v: number) =>
  Math.min(SCRIM_MAX, Math.max(SCRIM_MIN, Math.round(Number.isFinite(v) ? v : SCRIM_DEFAULT)));

// 减少动效：用来关掉 §6 要求「>5s 循环动效可关」的那几个（天空漂移、星点闪烁）。
export function getReduceMotion(): boolean {
  try {
    return localStorage.getItem(MOTION_KEY) === "1";
  } catch {
    return false;
  }
}

export function setReduceMotion(on: boolean) {
  const el = document.documentElement;
  if (on) el.dataset.motion = "off";
  else delete el.dataset.motion;
  try {
    localStorage.setItem(MOTION_KEY, on ? "1" : "0");
  } catch {
    /* 隐私模式写不了：本次会话仍然生效，只是不跨会话记忆 */
  }
}

// 读取遮罩浓度（百分比整数），供控件初始化。
export function getScrimAlpha(): number {
  try {
    const raw = localStorage.getItem(SCRIM_KEY);
    return raw === null ? SCRIM_DEFAULT : clampScrim(Number(raw));
  } catch {
    return SCRIM_DEFAULT; // SSR / 隐私模式兜底
  }
}

// 存遮罩浓度，返回夹紧后的值。
// ⚠️ 只写 localStorage，不写 <html> 上的自定义属性：遮罩是**某一页局部**的效果
// （游玩页的 `--reader-veil` 挂在该页根元素上），挂到 <html> 会漏到每一页去。
export function setScrimAlpha(v: number): number {
  const n = clampScrim(v);
  try {
    localStorage.setItem(SCRIM_KEY, String(n));
  } catch {
    /* 同上 */
  }
  return n;
}
