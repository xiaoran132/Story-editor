"use client";

// 开屏动画「播不播」的唯一判定。
//
// **两个写入方**：星海（`/`，播完或跳过时写）与登录页（`/login`，提交成功时写——
// 那边的六层天空刚演过一遍「世界生成」，紧接着再播 2.6s 是同一件事说两遍）。
// 判定逻辑放这里一处，别在两页各写一遍。
//
// ⚠️ 规则从「只播首次」改成「隔一段时间再播」（2026-08-20）。
// 原规则用一个**永久**的 localStorage 键记「看过了」，代价是：一个用户注册那天
// 之后再也看不到这 2.6 秒——而登录页也写这个键，所以多数人是在注册那一刻
// 就把它用掉了，实际等于「这个签名镜头只存在一次，且多半没被看见」。
// 现在存的是时间戳，超过 TTL 就再演一遍。DESIGN.md §6 / §7.1 / §7.6 / §8 已同步。

const KEY = "wanxiang-intro-seen-v1";

/** 多久之后再演一遍。一次工作/阅读时段里反复进站不该被反复打断，隔天回来该有开场。 */
const TTL_MS = 6 * 60 * 60 * 1000;

/** 最近看过吗？看过就跳过开屏。读不到、坏值、超期一律当作「没看过」。 */
export function introSeenRecently(): boolean {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return false;
    const t = Number(raw);
    // 旧版本存的是字面量 "1"。Number("1") = 1ms ≈ 1970 年，必然超期——
    // 于是所有老用户下次进站会看到一次开屏。这是有意的迁移行为，不是巧合。
    if (!Number.isFinite(t) || t <= 0) return false;
    return Date.now() - t < TTL_MS;
  } catch {
    // 隐私模式读不到 localStorage：当作没看过，宁可多演一遍也不要静默吞掉
    return false;
  }
}

/** 记下「刚看过」。 */
export function markIntroSeen(): void {
  try {
    window.localStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* 写不了就下次再演一遍，不影响任何功能 */
  }
}
