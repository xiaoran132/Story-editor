"use client";

import { useEffect } from "react";
import { getReduceMotion, setReduceMotion } from "@/lib/readerPrefs";

// 把存在 localStorage 里的全局偏好套回 <html>。
// 挂在 root layout：偏好要在**每次加载**生效，而不只是在设置页里点开关的那一刻。
// 遮罩浓度是**某一页局部**的效果（游玩页根元素上的 --reader-veil），由那一页自己套用，不归这里管。
export default function PrefsBoot() {
  useEffect(() => {
    setReduceMotion(getReduceMotion());
  }, []);
  return null;
}
