"use client";

import { useEffect } from "react";
import { getReduceMotion, setReduceMotion } from "@/lib/useReadingTheme";

// 把存在 localStorage 里的全局偏好套回 <html>。
// 挂在 root layout：偏好要在**每次加载**生效，而不只是在设置页里点开关的那一刻。
// 昼夜/遮罩是阅读态局部偏好，由 useReadingTheme 在进入阅读态时套用，不归这里管。
export default function PrefsBoot() {
  useEffect(() => {
    setReduceMotion(getReduceMotion());
  }, []);
  return null;
}
