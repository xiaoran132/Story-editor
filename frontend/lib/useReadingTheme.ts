"use client";

import { useEffect } from "react";

const MODE_KEY = "reading-mode"; // 玩家昼/夜偏好，跨会话记忆
const MOTION_KEY = "reduce-motion"; // 玩家「减少动效」偏好
const SCRIM_KEY = "reading-scrim"; // 玩家遮罩浓度偏好（百分比整数），跨会话记忆

// 遮罩浓度的硬边界：与 globals.css 的 --scrim-alpha-min(.52) 及滑块 max 对齐，
// 低于下限正文对比不达 AA。读写两侧都夹一次，防脏值。
export const SCRIM_MIN = 52;
export const SCRIM_MAX = 92;
export const SCRIM_DEFAULT = 74;
const clampScrim = (v: number) =>
  Math.min(SCRIM_MAX, Math.max(SCRIM_MIN, Math.round(Number.isFinite(v) ? v : SCRIM_DEFAULT)));

// 阅读态挂载：仅「走进作品之后」的体验页（作品详情 / 游玩）调用。
// 给 <html> 加 od-reading + data-work-theme（作品主题皮肤）+ data-mode（昼/夜）+ --scrim-alpha（遮罩浓度）。
// CSS 自定义属性只父→子继承，body 是页面容器祖先，故必须挂在 <html> 而非 .wrap。
// 卸载或切换时清除（含 inline 的 --scrim-alpha，否则会漏到外壳页并与控件 state 失同步）。
// coverUrl（可选）：作者上传的封面，走 CSS 早就预留好的 --reader-bg 替换点
// （globals.css:652 `.od-bg::after`）。它在场景色之上、颗粒/暗角/遮罩之下，
// 所以对比度护栏自动生效——不需要为封面单开一个「头图位」。
export function useReadingTheme(workTheme: string | undefined, coverUrl?: string) {
  useEffect(() => {
    const el = document.documentElement;
    el.classList.add("od-reading");
    el.dataset.workTheme = workTheme || "star";
    el.dataset.mode = getReadingMode();
    el.style.setProperty("--scrim-alpha", (getScrimAlpha() / 100).toFixed(2));
    if (coverUrl) el.style.setProperty("--reader-bg", `url("${coverUrl}")`);
    else el.style.removeProperty("--reader-bg");
    return () => {
      el.classList.remove("od-reading");
      delete el.dataset.workTheme;
      delete el.dataset.mode;
      delete el.dataset.scene;
      el.style.removeProperty("--scrim-alpha");
      el.style.removeProperty("--reader-bg");
    };
  }, [workTheme, coverUrl]);
}

// 氛围场景：在作品主题之上再叠一层辉光/强调覆盖（CSS 的 .od-reading[data-scene]）。
// 与昼夜/遮罩不同，这是**一次性的当下氛围**而非长期偏好，不持久化——
// 换作品后沿用上一部的氛围没有意义，退出阅读态时由 hook 清掉。
export const SCENES = [
  { id: "", label: "原色" },
  { id: "rose", label: "暖玫" },
  { id: "radio", label: "冷绿" },
] as const;

export function setReadingScene(scene: string) {
  const el = document.documentElement;
  if (scene) el.dataset.scene = scene;
  else delete el.dataset.scene;
}

// 减少动效：系统级 prefers-reduced-motion 之外的用户级开关，
// 用来关掉 §5 要求「>5s 循环动效可关」的那几个（如 16s 的活封面）。
// 写 <html data-motion="off">，CSS 侧已有对应规则。
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
    /* ignore */
  }
}

// 读取当前昼/夜（组件初始化控件态用）。
export function getReadingMode(): "day" | "night" {
  try {
    return localStorage.getItem(MODE_KEY) === "day" ? "day" : "night";
  } catch {
    return "night"; // SSR / 隐私模式兜底
  }
}

// 切换昼/夜：写 <html data-mode> + localStorage，供顶栏控件调用。
export function setReadingMode(mode: "day" | "night") {
  document.documentElement.dataset.mode = mode;
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

// 读取遮罩浓度（百分比整数），供控件初始化——与昼/夜同一套持久化语义。
export function getScrimAlpha(): number {
  try {
    const raw = localStorage.getItem(SCRIM_KEY);
    return raw === null ? SCRIM_DEFAULT : clampScrim(Number(raw));
  } catch {
    return SCRIM_DEFAULT;
  }
}

// 设遮罩浓度：写 <html style="--scrim-alpha"> + localStorage，返回夹紧后的值。
export function setScrimAlpha(v: number): number {
  const n = clampScrim(v);
  document.documentElement.style.setProperty("--scrim-alpha", (n / 100).toFixed(2));
  try {
    localStorage.setItem(SCRIM_KEY, String(n));
  } catch {
    /* ignore */
  }
  return n;
}
