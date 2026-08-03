import type { StoryNode } from "./types";
import { buildPath } from "./state";

// 把会话的全部节点（含 parent_id/depth）布局成一棵可用 SVG 渲染的树。
// 数据来源：GET /play/sessions/:id 的 nodes（回溯不删数据，故含所有已探索分支）。

// 布局常量（单位 px）
const ROW_H = 108; // 层间纵向间距（容两行节点标签）
const COL_W = 168; // 叶子列横向间距
const NODE_W = 148; // 节点框宽
export const NODE_H = 52; // 节点框高（StoryTree 用）
const PAD = 24; // 画布四周留白

interface PositionedNode {
  id: string;
  x: number; // 节点中心 x
  y: number; // 节点中心 y
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

// 计算树布局：叶子按出现顺序占据递增列，内部节点居中于其子节点之上。
export function layoutTree(
  nodes: StoryNode[],
  currentNodeId: string | null
): TreeLayout {
  const children = buildChildrenMap(nodes);
  const roots = children.get(null) ?? [];
  const onPath = new Set(
    buildPath(nodes, currentNodeId).map((n) => n.id)
  );

  const colOf = new Map<string, number>(); // 节点 → 列号
  const guard = new Set<string>(); // 防御环
  let nextLeaf = 0;
  let maxDepth = 0;

  // 后序遍历分配列号：叶子取新列，内部节点取子列均值。
  const assign = (node: StoryNode): number => {
    if (guard.has(node.id)) return colOf.get(node.id) ?? 0;
    guard.add(node.id);
    if (node.depth > maxDepth) maxDepth = node.depth;
    const kids = children.get(node.id) ?? [];
    let col: number;
    if (kids.length === 0) {
      col = nextLeaf++;
    } else {
      const cols = kids.map((k) => assign(k));
      col = (cols[0] + cols[cols.length - 1]) / 2;
    }
    colOf.set(node.id, col);
    return col;
  };
  for (const r of roots) assign(r);

  const toX = (col: number) => PAD + NODE_W / 2 + col * COL_W;
  const toY = (depth: number) => PAD + NODE_H / 2 + depth * ROW_H;

  const positioned: PositionedNode[] = nodes
    .filter((n) => colOf.has(n.id))
    .map((n) => ({
      id: n.id,
      x: toX(colOf.get(n.id)!),
      y: toY(n.depth),
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

  const width = PAD * 2 + NODE_W + Math.max(0, nextLeaf - 1) * COL_W;
  const height = PAD * 2 + NODE_H + maxDepth * ROW_H;
  return { nodes: positioned, edges, width, height };
}
