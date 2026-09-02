"use client";

import { useEffect, useState } from "react";

/**
 * 是否应当收起动效。**两个来源都要读**：
 *   ① 系统级 `prefers-reduced-motion: reduce`
 *   ② 设置页那个用户级开关（写 `<html data-motion="off">`，见 lib/readerPrefs.ts）
 * 只读其中一个，另一个就等于没接上。
 *
 * ⚠️ 初值恒为 false，判定放到挂载后：服务端没有 matchMedia 也没有 <html>，
 * 首帧若按真实偏好渲染必然与服务端产物不一致，React 直接报水合失配。
 * 代价是减动效用户会看到一帧完整态再落定，比整页水合失败划算。
 *
 * CSS 侧的收敛已在 wanxiang.css 做掉（两条选择器都写了），这个 hook 只服务
 * **必须由 JS 决定的分支**：登录页开页直接落 L4、星系跳过 2.6s 开屏。
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const read = () =>
      setReduced(mq.matches || document.documentElement.dataset.motion === "off");
    read();
    mq.addEventListener("change", read);
    // 设置页当场拨开关时不刷新页面，靠属性变化跟上
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-motion"],
    });
    return () => {
      mq.removeEventListener("change", read);
      obs.disconnect();
    };
  }, []);

  return reduced;
}
