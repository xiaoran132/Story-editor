import type { StoryNode } from "@/lib/types";
import { layoutTree, NODE_H } from "@/lib/tree";

// 已探索剧情线的星图视图（发光节点连线）。
// 完整展示该会话所有已探索分支：当前=暖金大星、主线=冷蓝发光、放弃分支=暗淡；点击历史节点回溯。

const LINE_MAX = 9; // 每行最大字数
const LINE_COUNT = 2; // 最多行数

// 节点完整标签文本（不截断，供 <title> 悬停显示全文）。
function label(n: StoryNode): string {
  if (!n.parent_id) return "开局";
  const t = (n.choice_text ?? "").trim();
  return t || "继续";
}

// 标签折行：按 LINE_MAX 切成最多 LINE_COUNT 行，超出末行省略——
// 兼顾"尽量展示全"与星图不被长句撑乱（约可显 18 字，覆盖多数选择）。
function labelLines(n: StoryNode): string[] {
  const text = label(n);
  const lines: string[] = [];
  for (let i = 0; i < text.length && lines.length < LINE_COUNT; i += LINE_MAX) {
    lines.push(text.slice(i, i + LINE_MAX));
  }
  if (text.length > LINE_MAX * LINE_COUNT) {
    lines[LINE_COUNT - 1] = lines[LINE_COUNT - 1].slice(0, LINE_MAX - 1) + "…";
  }
  return lines;
}

export default function StoryTree({
  nodes,
  currentNodeId,
  busy,
  onBacktrack,
  bare = false,
}: {
  nodes: StoryNode[];
  currentNodeId: string | null;
  busy: boolean;
  onBacktrack: (nodeId: string) => void;
  bare?: boolean; // true：省略自带标题与外边距，供抽屉容器承载（抽屉头已有标题）
}) {
  if (nodes.length <= 1) return null;
  const { nodes: pn, edges, width, height } = layoutTree(nodes, currentNodeId);

  return (
    <div className={`story-tree${bare ? " bare" : ""}`}>
      {!bare && <h2>剧情星图（点击历史节点可回溯）</h2>}
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
                <text className="label" x={p.x} y={p.y + NODE_H / 2} textAnchor="middle">
                  {labelLines(p.node).map((ln, i) => (
                    <tspan key={i} x={p.x} dy={i === 0 ? 0 : "1.25em"}>
                      {ln}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
