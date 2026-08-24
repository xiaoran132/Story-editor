"use client";

import { useEffect, useRef } from "react";
import type { StoryNode } from "@/lib/types";
import { layoutTree, NODE_H } from "@/lib/tree";
import styles from "./StoryTree.module.css";

// 世界星图：这一局走过的全部航点。
//
// ⚠️ **点一个航点只是查看，不改剧情。** 旧版本点节点就直接回溯——那是破坏性操作
// （会清掉该点之后的全部内容，包括玩家写下的自由行动）藏在一次普通点击后面。
// 现在选中只更新右侧的读数区，回溯要另外按「回到这里重新选择」。
// 这条分工来自 DESIGN §7.3 的检视器设计，不是我加的保险。

const LINE_MAX = 9; // 每行最大字数
const LINE_COUNT = 2; // 最多行数

/** 节点完整标签（不截断，供 <title> 与读数区用）。 */
export function nodeLabel(n: StoryNode): string {
  if (!n.parent_id) return "开局";
  const t = (n.choice_text ?? "").trim();
  return t || "继续";
}

// 标签折行：切成最多两行，超出末行省略——兼顾「尽量展示全」与星图不被长句撑乱。
function labelLines(n: StoryNode): string[] {
  const text = nodeLabel(n);
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
  selectedId,
  onSelect,
  active = false,
}: {
  nodes: StoryNode[];
  currentNodeId: string | null;
  /** 检视中的航点；读数区与回溯按钮都跟着它。 */
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  /** 星图可见：打开时把当前航点滚到视野中央，回答「我在哪」。 */
  active?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const layout = nodes.length > 0 ? layoutTree(nodes, currentNodeId) : null;
  // 最新布局放 ref 供滚动 effect 读取——把每次渲染新建的 layout 放进依赖，
  // 会在星图打开期间每次重渲都强制滚回当前星，与玩家手动滚动打架。
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => {
    if (!active) return;
    const el = scrollRef.current;
    const cur = layoutRef.current?.nodes.find((p) => p.isCurrent);
    if (!el || !cur) return;
    el.scrollTo({
      left: Math.max(0, cur.x - el.clientWidth / 2),
      top: Math.max(0, cur.y - el.clientHeight / 2),
      behavior: "smooth",
    });
  }, [active, currentNodeId]);

  if (!layout) return null;
  const { nodes: pn, edges, width, height } = layout;

  return (
    <div className={styles.scroll} ref={scrollRef}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={styles.svg}>
        {edges.map((e) => {
          // 弧线连接（父在上、子在下）：中点处平滑过渡，比直线更似星座
          const my = (e.y1 + e.y2) / 2;
          const d = `M ${e.x1} ${e.y1} C ${e.x1} ${my}, ${e.x2} ${my}, ${e.x2} ${e.y2}`;
          return (
            <path key={e.id} d={d} className={`${styles.edge} ${e.onPath ? styles.edgeOn : ""}`} />
          );
        })}

        {pn.map((p) => {
          const cls = [
            styles.node,
            p.isCurrent ? styles.current : p.onPath ? styles.visited : styles.branch,
            p.id === selectedId ? styles.inspected : "",
            p.node.is_ending ? styles.ending : "",
          ]
            .filter(Boolean)
            .join(" ");
          const r = p.isCurrent ? 7 : p.onPath ? 5.5 : 4.5;
          const title = nodeLabel(p.node);

          return (
            // SVG 的 <g> 不是原生可聚焦元素，靠 role + tabIndex + 键盘处理补齐
            <g
              key={p.id}
              className={cls}
              role="button"
              tabIndex={0}
              aria-label={`查看航点：${title}`}
              aria-current={p.isCurrent ? "true" : undefined}
              onClick={() => onSelect(p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(p.id);
                }
              }}
            >
              <title>{title}</title>
              {/* 透明命中圈：视觉半径 4.5–7px 远低于触控下限。
                  必须是 fill="transparent"，fill="none" 收不到指针事件。 */}
              <circle className={styles.hit} cx={p.x} cy={p.y} r={14} />
              <circle className={styles.halo} cx={p.x} cy={p.y} r={r + 3} />
              {p.node.is_ending && <circle className={styles.endRing} cx={p.x} cy={p.y} r={r + 6} />}
              <circle className={styles.ringIn} cx={p.x} cy={p.y} r={r + 8} />
              <circle className={styles.ring} cx={p.x} cy={p.y} r={r + 10} />
              <circle className={styles.core} cx={p.x} cy={p.y} r={r} />
              <circle className={styles.pip} cx={p.x} cy={p.y} r={r * 0.34} />
              <text x={p.x} y={p.y + NODE_H / 2} textAnchor="middle">
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
  );
}
