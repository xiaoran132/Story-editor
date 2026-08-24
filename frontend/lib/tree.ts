import type { StoryNode } from "./types";
import { buildPath } from "./state";

// 把会话的全部节点（含 parent_id/depth）布局成一条可用 SVG 渲染的航迹。
// 数据来源：GET /play/sessions/:id 的 nodes（回溯不删数据，故含所有已探索分支）。
//
// ⚠️ **轴向是横的，不是竖的。** 一局 session 的真实形状是一条长链——每回合只加一个
// 子节点，只有「回溯之后再选」才产生第二个分支。深度长、分支少。所以深度走 x（可横滑，
// 像时间轴），分支走 y（几乎总是一屏尽收）。旧版把深度铺在 y 上，深度 10 的局要在
// 1180px 画布里两轴滚动，一屏只看得到 3 个航点。

// 布局常量（单位 px）
const PAD = 26; // 画布四周留白
const ROW_H = 74; // 分支行距（纵向）
export const NODE_H = 52; // 节点框高：StoryTree 用它定标签基线
const LABEL_W = 112; // 标签框宽：首尾节点靠它撑出留白，不贴边
const STEP_MIN = 72; // 层距下限：再密标签就没字了
const STEP_MAX = 132; // 层距上限：短局不摊成稀疏的一条

export interface PositionedNode {
  id: string;
  x: number; // 节点中心 x（由 depth 决定）
  y: number; // 节点中心 y（由分支行号决定）
  node: StoryNode;
  isCurrent: boolean; // 玩家当前所在节点
  onPath: boolean; // 位于根→当前的主线上
}

interface Edge {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  onPath: boolean; // 父子两端都在主线上
}

interface TreeLayout {
  nodes: PositionedNode[];
  edges: Edge[];
  width: number;
  height: number;
  step: number; // 实际层距，标签裁字宽度要跟着它算
}

// 按 parent_id 分组子节点，子节点按 created_at 升序（探索先后）。
function buildChildrenMap(
  nodes: StoryNode[]
): Map<string | null, StoryNode[]> {
  const map = new Map<string | null, StoryNode[]>();
  for (const n of nodes) {
    const key = n.parent_id ?? null;
    const list = map.get(key);
    if (list) list.push(n);
    else map.set(key, [n]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  return map;
}

/**
 * 计算航迹布局。
 *
 * @param availWidth 视口可用宽度。给了就按它自适应层距，短局因此完全不用滚动；
 *   不给（首帧、无 ResizeObserver）回落 STEP_MAX。
 */
export function layoutTree(
  nodes: StoryNode[],
  currentNodeId: string | null,
  availWidth?: number
): TreeLayout {
  const children = buildChildrenMap(nodes);
  const roots = children.get(null) ?? [];
  const onPath = new Set(
    buildPath(nodes, currentNodeId).map((n) => n.id)
  );

  const rowOf = new Map<string, number>(); // 节点 → 行号
  const guard = new Set<string>(); // 防御环
  let nextRow = -1;
  let maxDepth = 0;

  // 先序遍历分配行号：第一个子节点**继承父行**，其余各开一行新的。
  // 子节点排序把「在主线上的那个」提到最前（sort 稳定，故 created_at 次序在同组内保持），
  // 于是根→当前那条线恒在同一行——主线是一条笔直的横线，被放弃的岔路挂在下面。
  // 行号只增不减，子树各自消费完才轮到下一个兄弟，构造上不可能重叠。
  const assign = (node: StoryNode, row: number) => {
    if (guard.has(node.id)) return;
    guard.add(node.id);
    rowOf.set(node.id, row);
    if (node.depth > maxDepth) maxDepth = node.depth;
    const kids = (children.get(node.id) ?? [])
      .slice()
      .sort((a, b) => (onPath.has(a.id) ? 0 : 1) - (onPath.has(b.id) ? 0 : 1));
    kids.forEach((k, i) => assign(k, i === 0 ? row : ++nextRow));
  };
  for (const r of roots) assign(r, ++nextRow);

  // 自适应层距：让整条航迹尽量一屏放下，放不下才落到下限并横向滚动。
  const span = Math.max(1, maxDepth);
  const raw = availWidth
    ? Math.floor((availWidth - PAD * 2 - LABEL_W) / span)
    : STEP_MAX;
  const step = Math.max(STEP_MIN, Math.min(STEP_MAX, raw));

  const toX = (depth: number) => PAD + LABEL_W / 2 + depth * step;
  const toY = (row: number) => PAD + NODE_H / 2 + row * ROW_H;

  const positioned: PositionedNode[] = nodes
    .filter((n) => rowOf.has(n.id))
    .map((n) => ({
      id: n.id,
      x: toX(n.depth),
      y: toY(rowOf.get(n.id)!),
      node: n,
      isCurrent: n.id === currentNodeId,
      onPath: onPath.has(n.id),
    }));

  const posById = new Map(positioned.map((p) => [p.id, p]));
  const edges: Edge[] = [];
  for (const p of positioned) {
    const pid = p.node.parent_id;
    if (!pid) continue;
    const parent = posById.get(pid);
    if (!parent) continue;
    edges.push({
      id: `${pid}-${p.id}`,
      x1: parent.x,
      y1: parent.y,
      x2: p.x,
      y2: p.y,
      onPath: p.onPath && parent.onPath,
    });
  }

  const width = PAD * 2 + LABEL_W + maxDepth * step;
  const height = PAD * 2 + NODE_H + Math.max(0, nextRow) * ROW_H;
  return { nodes: positioned, edges, width, height, step };
}
