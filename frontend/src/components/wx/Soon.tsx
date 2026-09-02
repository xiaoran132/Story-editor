import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./Soon.module.css";

// 「开发中」占位页。**有入口、无假数据**（plan.md §一）。
//
// 为什么保留入口却不渲染内容：这两处（社区 / 消息）后端是零路由零表零 handler。
// 原型里它们是完整的分叉事件流与消息列表——照着渲染出来的每一条都会被当成真的。
// 更早的教训在 handoff §7.1：社区空壳曾返回 `success:true`，调用方据此误判点赞成功。
// 所以这里连一条占位数据都不放，只说清楚现在有什么、还没有什么。

export type SoonProps = {
  eyebrow: string;
  title: string;
  body: ReactNode;
  /** 已经能用的那部分。「建设中」不等于「什么都没有」。 */
  have?: ReactNode;
  exits: { href: string; label: string }[];
};

export default function Soon({ eyebrow, title, body, have, exits }: SoonProps) {
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h1 className={styles.h1}>{title}</h1>
      <div className={styles.body}>{body}</div>
      {have && <div className={styles.have}>{have}</div>}
      <div className={styles.exits}>
        {exits.map((e) => (
          <Link className={styles.ghost} key={e.href} href={e.href}>
            {e.label}
          </Link>
        ))}
      </div>
    </main>
  );
}
