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
}: {
  item: SessionListItem;
  onClick: () => void;
}) {
  const ended = item.status === "ended";
  return (
    <div className="card" onClick={onClick}>
      <div className="title">{item.story_title || "未命名作品"}</div>
      <div className="metaline">
        <span className={`badge ${ended ? "ended" : "active"}`}>
          {ended ? "已结局" : "进行中"}
        </span>
        <span>第 {Math.max(0, item.node_count - 1)} 步</span>
        <span>{fmtTime(item.last_played_at)}</span>
      </div>
      <div className="desc">{ended ? "回顾这段旅程或回溯重玩" : "继续这段旅程"}</div>
    </div>
  );
}
