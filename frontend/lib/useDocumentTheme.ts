"use client";

import { useEffect } from "react";

// 作品级换肤：把主题 id 挂到 <html data-theme>，使含 body 星云在内的全部 CSS 变量随之切换
// （CSS 自定义属性只父→子继承，body 是页面容器的祖先，故必须挂在 <html> 而非 .wrap）。
// 仅体验页（作品详情 / 游玩）调用；卸载或切换时清除，外壳页恢复默认 star。
export function useDocumentTheme(theme: string | undefined) {
  useEffect(() => {
    const el = document.documentElement;
    const t = theme || "star";
    if (t === "star") el.removeAttribute("data-theme");
    else el.dataset.theme = t;
    return () => {
      el.removeAttribute("data-theme");
    };
  }, [theme]);
}
