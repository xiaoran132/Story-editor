"use client";

import { useState } from "react";
import type { SessionListItem } from "@/lib/types";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SessionCard({
  item,
  onClick,
  onDelete,
}: {
  item: SessionListItem;
  onClick: () => void;
  onDelete: () => void;
}) {
  const ended = item.status === "ended";
  const [confirming, setConfirming] = useState(false);

  // 删除按钮：首次点亮二次确认，再点才真正删除；离开时自动收起。
  const handleDel = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirming) {
      onDelete();
    } else {
      setConfirming(true);
    }
  };

  return (
    <div className="card session" onClick={onClick}>
      <button
        className={`card-del${confirming ? " confirm" : ""}`}
        title="删除这段旅程"
        aria-label="删除这段旅程"
        onClick={handleDel}
        onMouseLeave={() => setConfirming(false)}
      >
        {confirming ? "确认删除" : "×"}
      </button>

      <div className="title">{item.story_title || "未命名作品"}</div>
      <div className="metaline">
        <span className={`badge ${ended ? "ended" : "active"}`}>
          {ended ? "已结局" : "进行中"}
        </span>
        <span>第 {Math.max(0, item.node_count - 1)} 步</span>
        <span>{fmtTime(item.last_played_at)}</span>
      </div>
      <div className="desc">
        {ended ? "回顾这段旅程或回溯重玩" : "继续这段旅程"}
      </div>
    </div>
  );
}
