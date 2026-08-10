"use client";

import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import { EmptyState } from "@/components/State";

// 社区（占位）：后端 community 为 stub，先给管理态外壳 + 空态 + 出路。
export default function CommunityPage() {
  return (
    <>
      <AppHeader />
      <main>
        {/* 占位页也要有 h1，否则地标树里这一页没有主标题 */}
        <h1 className="sr-only">社区</h1>
        <EmptyState
          title="社区即将开放"
          desc="作品分享、点赞、评论与路线共创正在路上。先去发现页挑一个世界走进去吧。"
          icon={
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          }
          action={
            <Link className="btn primary sm" href="/">
              去发现
            </Link>
          }
        />
      </main>
    </>
  );
}
