"use client";

import type { ReactNode } from "react";

// 异步列表三态组件（DESIGN §7）：加载(骨架) / 空 / 错误，空与错误都给出路。
// 图标一律单线 SVG（禁 emoji）。

// 骨架卡：网格加载占位。与真实卡片一样等大，避免加载态与落地后的布局跳动。
export function SkeletonCard() {
  return (
    <div className="sk-card" aria-hidden="true">
      <div className="c shimmer" />
      <div className="l shimmer" />
      <div className="l s shimmer" />
    </div>
  );
}

// 骨架墙：默认铺 8 张，与作品墙同一套网格。
export function SkeletonWall({ count = 8 }: { count?: number }) {
  return (
    <div className="wall" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

const SearchIcon = (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);
const AlertIcon = (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M12 9v4M12 17h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 18L13.7 3.9a2 2 0 0 0-3.4 0z" />
  </svg>
);

// 空态：给标题 + 说明 + 出路动作。
export function EmptyState({
  title,
  desc,
  icon,
  action,
}: {
  title: string;
  desc?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="state" role="status">
      <div className="ic">{icon ?? SearchIcon}</div>
      <h2>{title}</h2>
      {desc && <p>{desc}</p>}
      {action && <div className="act">{action}</div>}
    </section>
  );
}

// 错误态：说明 + 重试出路。
export function ErrorState({
  title = "没能加载出来",
  desc = "网络波动或服务暂不可用。稍等片刻，再试一次。",
  action,
}: {
  title?: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <section className="state err" role="alert">
      <div className="ic">{AlertIcon}</div>
      <h2>{title}</h2>
      <p>{desc}</p>
      {action && <div className="act">{action}</div>}
    </section>
  );
}
