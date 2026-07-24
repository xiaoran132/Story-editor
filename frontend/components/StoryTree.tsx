import type { StoryNode } from "@/lib/types";
import { layoutTree, NODE_H } from "@/lib/tree";

// 已探索剧情线的星图视图（发光节点连线）。
// 完整展示该会话所有已探索分支：当前=暖金大星、主线=冷蓝发光、放弃分支=暗淡；点击历史节点回溯。

const LABEL_MAX = 10; // 节点标签最大字数

function label(n: StoryNode): string {
  if (!n.parent_id) return "开局";
  const t = (n.choice_text ?? "").trim();
  if (!t) return "继续";
  return t.length > LABEL_MAX ? t.slice(0, LABEL_MAX) + "…" : t;
}

export default function StoryTree({
  nodes,
  currentNodeId,
  busy,
  onBacktrack,
}: {
  nodes: StoryNode[];
  currentNodeId: string | null;
  busy: boolean;
  onBacktrack: (nodeId: string) => void;
}) {
  if (nodes.length <= 1) return null;
  const { nodes: pn, edges, width, height } = layoutTree(nodes, currentNodeId);

  return (
    <div className="story-tree">
      <h2>剧情星图（点击历史节点可回溯）</h2>
      <div className="tree-scroll">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="tree-svg"
        >
          {edges.map((e) => (
            <line
              key={e.id}
              x1={e.x1}
              y1={e.y1}
              x2={e.x2}
              y2={e.y2}
              className={`tree-edge${e.onPath ? " on" : ""}`}
            />
          ))}
          {pn.map((p) => {
            const clickable = !busy && !p.isCurrent;
            const cls = p.isCurrent ? "cur" : p.onPath ? "on" : "dim";
            const r = p.isCurrent ? 7 : p.onPath ? 5.5 : 4.5;
            return (
              <g
                key={p.id}
                className={`tree-node ${cls}${clickable ? " clickable" : ""}`}
                onClick={() => {
                  if (clickable) onBacktrack(p.id);
                }}
              >
                <title>
                  {p.node.is_ending
                    ? `结局${
                        p.node.ending_type ? "：" + p.node.ending_type : ""
                      }`
                    : label(p.node)}
                </title>
                {p.node.is_ending && (
                  <circle className="ring" cx={p.x} cy={p.y} r={r + 4} />
                )}
                <circle className="dot" cx={p.x} cy={p.y} r={r} />
                <text
                  className="label"
                  x={p.x}
                  y={p.y + NODE_H / 2}
                  textAnchor="middle"
                >
                  {label(p.node)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
