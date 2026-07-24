import type { StoryNode } from "@/lib/types";

export default function Timeline({
  path,
  busy,
  onBacktrack,
}: {
  path: StoryNode[];
  busy: boolean;
  onBacktrack: (nodeId: string, index: number) => void;
}) {
  if (path.length <= 1) return null;
  return (
    <div className="timeline">
      <h2>时间线（点击可回溯）</h2>
      {path.map((n, i) => {
        const cur = i === path.length - 1;
        const label = n.choice_text ? `→ ${n.choice_text}` : "【开局】";
        return (
          <div
            key={n.id}
            className={`step${cur ? " cur" : ""}`}
            onClick={() => {
              if (!busy && !cur) onBacktrack(n.id, i);
            }}
          >
            第 {i} 步 {label}
          </div>
        );
      })}
    </div>
  );
}
