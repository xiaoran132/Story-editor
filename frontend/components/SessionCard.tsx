"use client";

import { useState } from "react";
import Link from "next/link";
import { assetUrl } from "@/lib/api";
import { coverStyle, type SessionListItem } from "@/lib/types";
import { IconTrash } from "@/components/icons";

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

// 管理态存档卡（原型 my-space.html:194-201 的 `.save` 行）：
// 主题渐变缩略 + 作品名 + 进度 + 删除（行内二次确认）。
// 整行是链接，删除按钮盖在上层——注意 preventDefault，否则点删除会连带跳转。
export default function SessionCard({
  item,
  theme,
  cover,
  onDelete,
}: {
  item: SessionListItem;
  theme?: string; // 作品主题 id，用于缩略色块；拿不到就用默认星海
  cover?: string; // 作品封面（仅自己的作品拿得到），无则用主题渐变
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const ended = item.status === "ended";

  return (
    <div className="session-card">
      <button
        className={`icon-del${confirming ? " confirm" : ""}`}
        aria-label={confirming ? "确认删除这段旅程" : "删除这段旅程"}
        onClick={(e) => {
          e.preventDefault();
          if (confirming) onDelete();
          else setConfirming(true);
        }}
        onMouseLeave={() => setConfirming(false)}
      >
        {confirming ? "确认删除" : <IconTrash size={15} />}
      </button>
      <Link href={`/play/${item.id}`} className="sc-link">
        <span
          className="sc-cov"
          aria-hidden="true"
          style={coverStyle(theme, assetUrl(cover ?? ""))}
        />
        <span className="sc-body">
          <span className="sc-title">{item.story_title || "未命名作品"}</span>
          <span className="sc-meta">
            <span className={`badge ${ended ? "info" : "ok"}`}>{ended ? "已结局" : "进行中"}</span>
            <span>第 {Math.max(0, item.node_count - 1)} 步</span>
            <span>{fmtTime(item.last_played_at)}</span>
          </span>
        </span>
      </Link>
    </div>
  );
}
