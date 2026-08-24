"use client";

import { useEffect, useRef, useState } from "react";
import type { StoryNode } from "@/lib/types";
import { layoutTree, NODE_H, FILLER_CHOICE, type PositionedNode } from "@/lib/tree";
import styles from "./StoryTree.module.css";

// 世界星图：这一局走过的全部航点，深度铺在横轴上（轴向的理由见 lib/tree.ts）。
//
// ⚠️ **点一个航点只是查看，不改剧情。** 回溯要另外按「回到这里重新选择」——两件事
// 分开，来自 DESIGN §7.3 的检视器设计。
// 回溯本身**不删任何数据**（backend/internal/service/play.go 的 Backtrack）：它只把
// current_node_id 移回该航点，并恢复那时的 current_state / revealed_attrs。走过的分支
// 全部留在图上，随时能再回去。别再把它描述成破坏性操作——那句假警告正好吓住了星图的
// 核心用途。

/** 折叠星的标签：一段没有分叉的翻页收成一颗，标出步数。 */
export function foldedLabel(count: number): string {
  return `${FILLER_CHOICE} ×${count}`;
}

/** 显示项的完整标签（不截断，供 <title> 用）。 */
function itemLabel(p: PositionedNode): string {
  return p.collapsed ? foldedLabel(p.collapsed.length) : nodeLabel(p.node);
}

/** 节点完整标签（不截断，供 <title> 与读数区用）。 */
export function nodeLabel(n: StoryNode): string {
  if (!n.parent_id) return "开局";
  const t = (n.choice_text ?? "").trim();
  return t || "继续";
}

// 标签裁字：单行，宽度跟着实际层距走。横向流里两行标签会上下压到隔壁分支行，
// 所以这里只留一行；完整文本在 <title> 与右侧读数区。
function labelText(text: string, step: number): string {
  const max = Math.max(3, Math.floor((step - 10) / 11.5));
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
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
  const [availWidth, setAvailWidth] = useState<number | undefined>(undefined);
  // 已展开的折叠段（存段首节点 id）。抽屉一关就清空：每次打开都回到干净的默认视图，
  // 玩家不必记得上次展开过哪几段。
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 量视口宽 → 自适应层距。初值 undefined（服务端没有 ResizeObserver，首帧若按真实
  // 宽度渲染会水合失配），layoutTree 那侧回落 STEP_MAX。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      // 迟滞：纵向滚动条出现会改 clientWidth，不设阈值会为几像素反复重排。
      setAvailWidth((prev) =>
        prev === undefined || Math.abs(prev - w) > 8 ? w : prev
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout =
    nodes.length > 0 ? layoutTree(nodes, currentNodeId, availWidth, expanded) : null;
  // 最新布局放 ref 供滚动与键盘 effect 读取——把每次渲染新建的 layout 放进依赖，
  // 会在星图打开期间每次重渲都强制滚回当前星，与玩家手动滚动打架。
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // 打开时把「所在处」居中；开着的时候只把选中项拉回视野，不强行居中。
  // 两件事合在一个 effect 里：拆成两个会在打开那一帧同时发两次 scrollTo，
  // 而 smooth 滚动是异步的，后一次读到的 scrollLeft 还是旧值，两者互相打架。
  const openedRef = useRef(false);
  useEffect(() => {
    if (!active) {
      openedRef.current = false;
      setExpanded((prev) => (prev.size ? new Set() : prev)); // 空集时不 set，免得白重渲
      return;
    }
    const el = scrollRef.current;
    const lay = layoutRef.current;
    if (!el || !lay) return;
    const cur = lay.nodes.find((p) => p.isCurrent);
    const target =
      lay.nodes.find(
        (p) => p.id === selectedId || p.collapsed?.some((n) => n.id === selectedId)
      ) ?? cur;
    if (!target) return;

    if (!openedRef.current) {
      openedRef.current = true;
      const c = cur ?? target;
      el.scrollTo({
        left: Math.max(0, c.x - el.clientWidth / 2),
        top: Math.max(0, c.y - el.clientHeight / 2),
        behavior: "smooth",
      });
      return;
    }

    const M = 72; // 边距：选中项旁边留出上下文，而不是紧贴视口边缘
    const l = el.scrollLeft;
    const t = el.scrollTop;
    let left = l;
    let top = t;
    if (target.x - M < l) left = Math.max(0, target.x - M);
    else if (target.x + M > l + el.clientWidth) left = target.x + M - el.clientWidth;
    if (target.y - M < t) top = Math.max(0, target.y - M);
    else if (target.y + M > t + el.clientHeight) top = target.y + M - el.clientHeight;
    if (left !== l || top !== t) el.scrollTo({ left, top, behavior: "smooth" });
  }, [active, currentNodeId, selectedId]);

  // 焦点跟着选中项走。roving tabindex 下只有它是 tabIndex=0，
  // 所以必须显式把焦点搬过去，否则方向键走一步就丢焦点。
  // 点折叠星 = 展开它，而不是检视。星图兼着回溯入口，直接吞掉这些航点会让玩家
  // 没法回到翻页途中用自由输入岔出去；展开后它们就是普通航点，检视/回溯照旧。
  const activate = (p: PositionedNode) => {
    if (p.collapsed) {
      // 整段的 id 都要进集合：只放段首的话，布局走到第二个节点又会折出一段新的。
      const members = p.collapsed.map((n) => n.id);
      setExpanded((prev) => new Set([...prev, ...members]));
      focusNode(members[0]);
      return;
    }
    onSelect(p.id);
  };

  const focusNode = (id: string) => {
    requestAnimationFrame(() => {
      scrollRef.current?.querySelector<SVGGElement>(`[data-node="${id}"]`)?.focus();
    });
  };

  const onKeyDown = (e: React.KeyboardEvent, p: PositionedNode) => {
    const lay = layoutRef.current;
    if (!lay) return;
    const at = lay.nodes;
    let target: PositionedNode | undefined;

    switch (e.key) {
      case "ArrowRight": {
        // 子节点优先取「同一行」的那个——按布局约定它就是主线上的子节点
        const kids = at.filter((q) => q.parentItemId === p.id).sort((a, b) => a.y - b.y);
        target = kids.find((k) => k.y === p.y) ?? kids[0];
        break;
      }
      case "ArrowLeft":
        target = at.find((q) => q.id === p.parentItemId);
        break;
      case "ArrowUp":
      case "ArrowDown": {
        // 同一**显示列**的其它分支：视觉上就是上下相邻的那颗星。
        // 用 node.depth 会在折叠后错位——折叠段把后续节点整体左移了。
        const peers = at.filter((q) => q.col === p.col).sort((a, b) => a.y - b.y);
        const i = peers.findIndex((q) => q.id === p.id);
        target = peers[e.key === "ArrowUp" ? i - 1 : i + 1];
        break;
      }
      case "Home":
        target = at.find((q) => !q.parentItemId);
        break;
      case "End":
        target = at.find((q) => q.isCurrent);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        activate(p);
        return;
      default:
        return;
    }

    e.preventDefault();
    if (!target || target.id === p.id) return;
    onSelect(target.id);
    focusNode(target.id);
  };

  if (!layout) return null;
  const { nodes: pn, edges, width, height, step } = layout;

  // 节点 id → 所属显示项。selectedId 指向的节点可能正被折在某颗星里（抽屉重开会重新折叠），
  // 直接拿它当显示项 id 用会找不到东西：roving 会指向不存在的项，Tab 环里一个可聚焦元素都没有。
  const itemFor = (nodeId: string | null) =>
    nodeId
      ? pn.find((p) => p.id === nodeId || p.collapsed?.some((n) => n.id === nodeId))
      : undefined;
  const selectedItem = itemFor(selectedId);

  // Tab 环里只留一个航点：否则 30 个航点全在环里，玩家要按 30 下才走到
  // 「回到这里重新选择」（游玩页那个焦点陷阱按 [tabindex] 选人）。
  const roving =
    selectedItem?.id ?? pn.find((p) => p.isCurrent)?.id ?? pn[0]?.id ?? null;

  return (
    <div className={styles.scroll} ref={scrollRef}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={styles.svg}>
        {edges.map((e) => {
          // 弧线连接（父在左、子在右）：中点处平滑过渡，比直线更似星座
          const mx = (e.x1 + e.x2) / 2;
          const d = `M ${e.x1} ${e.y1} C ${mx} ${e.y1}, ${mx} ${e.y2}, ${e.x2} ${e.y2}`;
          return (
            <path key={e.id} d={d} className={`${styles.edge} ${e.onPath ? styles.edgeOn : ""}`} />
          );
        })}

        {pn.map((p) => {
          const cls = [
            styles.node,
            p.isCurrent ? styles.current : p.onPath ? styles.visited : styles.branch,
            p.id === selectedItem?.id ? styles.inspected : "",
            p.node.is_ending ? styles.ending : "",
            p.collapsed ? styles.folded : "",
          ]
            .filter(Boolean)
            .join(" ");
          const r = p.isCurrent ? 7 : p.onPath ? 5.5 : 4.5;
          const title = itemLabel(p);

          return (
            // SVG 的 <g> 不是原生可聚焦元素，靠 role + tabIndex + 键盘处理补齐
            <g
              key={p.id}
              data-node={p.id}
              className={cls}
              role="button"
              tabIndex={p.id === roving ? 0 : -1}
              aria-label={
                p.collapsed
                  ? `展开 ${p.collapsed.length} 个连续翻页航点`
                  : `查看航点：${title}`
              }
              aria-expanded={p.collapsed ? false : undefined}
              aria-current={p.isCurrent ? "true" : undefined}
              onClick={() => activate(p)}
              onKeyDown={(e) => onKeyDown(e, p)}
            >
              <title>{title}</title>
              {/* 透明命中圈：视觉半径 4.5–7px 远低于触控下限。
                  必须是 fill="transparent"，fill="none" 收不到指针事件。 */}
              <circle className={styles.hit} cx={p.x} cy={p.y} r={14} />
              <circle className={styles.halo} cx={p.x} cy={p.y} r={r + 3} />
              {p.node.is_ending && <circle className={styles.endRing} cx={p.x} cy={p.y} r={r + 6} />}
              {/* 折叠星：两侧小点 = 「这里压着好几颗」。不用环——虚线环已经是结局的
                  语汇（.ending .endRing）。点沿横轴排，正对被压缩掉的那一段。 */}
              {p.collapsed && (
                <>
                  <circle className={styles.foldDot} cx={p.x - r - 5} cy={p.y} r={1.8} />
                  <circle className={styles.foldDot} cx={p.x + r + 5} cy={p.y} r={1.8} />
                </>
              )}
              <circle className={styles.ringIn} cx={p.x} cy={p.y} r={r + 8} />
              <circle className={styles.ring} cx={p.x} cy={p.y} r={r + 10} />
              <circle className={styles.core} cx={p.x} cy={p.y} r={r} />
              <circle className={styles.pip} cx={p.x} cy={p.y} r={r * 0.34} />
              <text x={p.x} y={p.y + NODE_H / 2} textAnchor="middle">
                {labelText(title, step)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
