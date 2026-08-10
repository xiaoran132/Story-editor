"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// 全站轻提示。此前 admin / me / StoryLLMConfigPanel / StoryEditor 各写了一份
// `setState + setTimeout`，时长还不一致（2400 / 2400 / 2200），且都没在卸载时清 timer
// —— 组件卸载后 timer 仍会触发 setState。这里收敛成一处。
const DURATION = 2400;

export function useToast() {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((msg: string) => {
    if (timer.current) clearTimeout(timer.current); // 连续两次提示时重新计时，不叠加
    setToast(msg);
    timer.current = setTimeout(() => setToast(null), DURATION);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return { toast, show, node: <Toast message={toast} /> };
}

// 单独导出，供 toast 文案存在外部 store 的场景（如 editorStore.toast）复用样式与语义。
export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  // role=status + aria-live：提示是异步出现的，不这样标屏幕阅读器读不到。
  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}
