"use client";

import { useEffect, useRef } from "react";
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
  active = false,
}: {
  nodes: StoryNode[];
  currentNodeId: string | null;
  busy: boolean;
  onBacktrack: (nodeId: string) => void;
  bare?: boolean; // true：省略自带标题与外边距，供抽屉容器承载（抽屉头已有标题）
  active?: boolean; // 抽屉可见：打开时把当前节点滚到视野中央，回答"我在哪"
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const layout = nodes.length > 1 ? layoutTree(nodes, currentNodeId) : null;
  // 最新布局放进 ref，供滚动 effect 读取——避免把每次渲染新建的 layout 放进依赖，
  // 那会在抽屉打开期间每次重渲染都强制滚回当前星、与玩家手动滚动打架。
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // 仅当"打开抽屉 / 当前节点变化"时，把当前星滚到滚动区中央，回答"我在哪"。
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
    <div className={`story-tree${bare ? " bare" : ""}`}>
      {!bare && <h2>剧情星图（点击历史节点可回溯）</h2>}
      <div className="tree-scroll" ref={scrollRef}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="tree-svg"
        >
          {edges.map((e) => {
            // 弧线连接（父在上、子在下）：中点处平滑过渡，比直线更似星座
            const my = (e.y1 + e.y2) / 2;
            const d = `M ${e.x1} ${e.y1} C ${e.x1} ${my}, ${e.x2} ${my}, ${e.x2} ${e.y2}`;
            return <path key={e.id} d={d} className={`tree-edge${e.onPath ? " on" : ""}`} />;
          })}
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
                    ? `结局${p.node.ending_type ? "：" + p.node.ending_type : ""}`
                    : label(p.node)}
                </title>
                {p.node.is_ending && <circle className="ring" cx={p.x} cy={p.y} r={r + 4} />}
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
