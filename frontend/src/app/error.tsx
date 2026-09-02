"use client";

import Link from "next/link";
import { useEffect } from "react";
import Backdrop from "@/components/sky/Backdrop";
import styles from "./error.module.css";

// 全局错误边界：任何页面抛错都在这里兜住，不再白屏。
// 与 404 的分工：404 是叙事（掉出星空），这里是运行时故障的克制兜底——
// 用户要的是「还能干什么」，不是散文。文案只说事实：出了什么、能去哪。

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // digest 是 Next 给同一次构建内错误分配的指纹，报障时报它比报堆栈有用。
    console.error("[error-boundary]", error.digest ?? error.message);
  }, [error]);

  return (
    <div className={styles.root}>
      <Backdrop />
      <main className={styles.shell}>
        <p className={styles.eyebrow}>万象 · 无穷世界</p>
        <h1 className={styles.h1}>这里断了一下</h1>
        <p className={styles.lede}>
          页面没能正常加载。刚才的操作没有丢失，重试通常就能恢复。
        </p>
        {error.digest && (
          <p className={styles.digest}>故障标识 {error.digest}</p>
        )}
        <div className={styles.exits}>
          <button className={styles.primary} onClick={reset}>
            重试
          </button>
          <Link className={styles.ghost} href="/">
            回到星海
          </Link>
        </div>
      </main>
    </div>
  );
}
