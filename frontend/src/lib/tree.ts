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
  id: string; // 单节点用 node.id；折叠段用 `run:<段首节点 id>`
  x: number; // 节点中心 x（由**显示列**决定，不是 depth——折叠段只占一列）
  y: number; // 节点中心 y（由分支行号决定）
  col: number; // 显示列号，键盘上下键找同列邻居要用
  parentItemId: string | null; // 父显示项的 id（连线与左右键都基于它）
  node: StoryNode; // 折叠段取**末节点**：它的 state_snapshot 是这段的终态
  isCurrent: boolean; // 玩家当前所在节点
  onPath: boolean; // 位于根→当前的主线上
  /** 非空 = 这是一颗折叠星，收着一段没有分叉的「继续」翻页；按时间序，node 即其末元素。 */
  collapsed?: StoryNode[];
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

// AI 这一回合没返回任何选项时，OptionList 只给一个「继续」按钮，提交的就是这个字面量。
// 这类节点**不是决策点**（当时只有一个按钮可按），因而在结构上必然不分叉。
export const FILLER_CHOICE = "继续";

/** 是不是一次「翻页」而非一次选择。空 choice_text 同样按翻页算（nodeLabel 也兜底成「继续」）。 */
export function isFillerChoice(n: StoryNode): boolean {
  if (!n.parent_id) return false; // 开局不是翻页
  const t = (n.choice_text ?? "").trim();
  return t === "" || t === FILLER_CHOICE;
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
 * 从 node 起沿单链收集一段可折叠的「继续」翻页。
 *
 * 一个节点能被收进来的条件：是翻页（不是真选择）、不是结局、没被展开。
 * 结局单独留一颗星：它是「这条到头了」，一局里最值钱的那种节点，省一列不值得。
 *
 * **两类东西只终止延伸，不阻止被收进来**，这是它有没有用的关键：
 *   - **分叉**：末节点有几个子节点都行，它们照样从折叠星上挂出去，结构一点没丢。
 *     改成「有分叉就不收」的话 root→继续→继续→{左,右} 整段不折，等于白做。
 *   - **当前所在**：它成为段的末节点，于是折叠星本身被标记为「当前所在」，`node` 也是它，
 *     检视面板拿到的仍是玩家真实的状态快照。**把当前所在整个排除在外是错的**——会话末尾
 *     几乎总是当前节点，排除它让每段尾巴都短一截，要连着 3 个「继续」才看得到一次折叠；
 *     真机上最长的一局只有 2 个连续「继续」，一颗都没折成。
 *     它也必须**终止**延伸：玩家回溯后当前节点会落在链中间，继续往下收就会把「我在哪」
 *     藏进段里，而 `node` 取的是末节点，检视面板会显示不属于玩家的状态。
 *
 * 返回长度 < 2 时调用方不折叠——一颗星换一颗星只会凭空多出一层解释成本。
 */
function collectRun(
  node: StoryNode,
  children: Map<string | null, StoryNode[]>,
  currentNodeId: string | null,
  expanded: Set<string>
): StoryNode[] {
  const run: StoryNode[] = [];
  let cur: StoryNode | undefined = node;
  while (cur && isFillerChoice(cur) && !cur.is_ending && !expanded.has(cur.id)) {
    run.push(cur);
    if (cur.id === currentNodeId) break; // 收下了，但当前所在必须是这一段的末节点
    // 显式标注：不写的话 cur = kids[0] 会让 kids 的推断绕回自己（TS7022）。
    const kids: StoryNode[] = children.get(cur.id) ?? [];
    if (kids.length !== 1) break; // 分叉/到头：收下，但不再往下延伸
    cur = kids[0];
  }
  return run;
}

/**
 * 计算航迹布局。
 *
 * @param availWidth 视口可用宽度。给了就按它自适应层距，短局因此完全不用滚动；
 *   不给（首帧、无 ResizeObserver）回落 STEP_MAX。
 * @param expanded 已展开的节点 id。**必须是段内每一个**，不能只存段首——只存段首的话，
 *   走到第二个节点时又会从它起折出一段新的，尾巴重新塌回去。
 *
 * ⚠️ **横轴是显示列，不是 depth。** 一段 N 步的翻页折叠后只占一列，后面的节点跟着左移；
 * 用 depth 定 x 会让折叠白做——星还是压在原来那么长的轴上，只是中间空了一片。
 */
export function layoutTree(
  nodes: StoryNode[],
  currentNodeId: string | null,
  availWidth?: number,
  expanded?: Set<string>
): TreeLayout {
  const children = buildChildrenMap(nodes);
  const roots = children.get(null) ?? [];
  const onPath = new Set(buildPath(nodes, currentNodeId).map((n) => n.id));
  const exp = expanded ?? new Set<string>();

  interface Item {
    id: string;
    row: number;
    col: number;
    node: StoryNode;
    collapsed?: StoryNode[];
  }
  const items: Item[] = [];
  const itemOf = new Map<string, string>(); // 成员节点 id → 所属显示项 id
  const guard = new Set<string>(); // 防御环
  let nextRow = -1;
  let maxCol = 0;

  // 先序遍历分配行号与显示列：第一个子节点**继承父行**，其余各开一行新的。
  // 子节点排序把「在主线上的那个」提到最前（sort 稳定，故 created_at 次序在同组内保持），
  // 于是根→当前那条线恒在同一行——主线是一条笔直的横线，被放弃的岔路挂在下面。
  // 行号只增不减，子树各自消费完才轮到下一个兄弟，构造上不可能重叠。
  const walk = (node: StoryNode, row: number, col: number) => {
    if (guard.has(node.id)) return;

    const run = collectRun(node, children, currentNodeId, exp);
    let head = node; // 这一显示项在树上的「出口」，子节点从它往下挂
    let item: Item;
    if (run.length >= 2) {
      head = run[run.length - 1];
      item = { id: `run:${run[0].id}`, row, col, node: head, collapsed: run };
      for (const n of run) {
        guard.add(n.id);
        itemOf.set(n.id, item.id);
      }
    } else {
      guard.add(node.id);
      item = { id: node.id, row, col, node };
      itemOf.set(node.id, item.id);
    }
    items.push(item);
    if (col > maxCol) maxCol = col;

    const kids = (children.get(head.id) ?? [])
      .slice()
      .sort((a, b) => (onPath.has(a.id) ? 0 : 1) - (onPath.has(b.id) ? 0 : 1));
    kids.forEach((k, i) => walk(k, i === 0 ? row : ++nextRow, col + 1));
  };
  for (const r of roots) walk(r, ++nextRow, 0);

  // 自适应层距：让整条航迹尽量一屏放下，放不下才落到下限并横向滚动。
  const span = Math.max(1, maxCol);
  const raw = availWidth
    ? Math.floor((availWidth - PAD * 2 - LABEL_W) / span)
    : STEP_MAX;
  const step = Math.max(STEP_MIN, Math.min(STEP_MAX, raw));

  const toX = (col: number) => PAD + LABEL_W / 2 + col * step;
  const toY = (row: number) => PAD + NODE_H / 2 + row * ROW_H;

  const positioned: PositionedNode[] = items.map((it) => {
    // 折叠段的父亲是**段首**的父亲；单节点就是它自己的父亲。
    const parentNodeId = (it.collapsed ? it.collapsed[0] : it.node).parent_id;
    return {
      id: it.id,
      x: toX(it.col),
      y: toY(it.row),
      col: it.col,
      parentItemId: (parentNodeId && itemOf.get(parentNodeId)) || null,
      node: it.node,
      // 当前所在若被折进来，必是该段末节点（collectRun 收下它就 break），
      // 而 it.node 取的正是末节点——于是这里对折叠星同样成立，折叠星会被标为当前所在。
      isCurrent: it.node.id === currentNodeId,
      onPath: onPath.has(it.node.id),
      ...(it.collapsed ? { collapsed: it.collapsed } : {}),
    };
  });

  const posById = new Map(positioned.map((p) => [p.id, p]));
  const edges: Edge[] = [];
  for (const p of positioned) {
    if (!p.parentItemId) continue;
    const parent = posById.get(p.parentItemId);
    if (!parent) continue;
    edges.push({
      id: `${parent.id}-${p.id}`,
      x1: parent.x,
      y1: parent.y,
      x2: p.x,
      y2: p.y,
      onPath: p.onPath && parent.onPath,
    });
  }

  const width = PAD * 2 + LABEL_W + maxCol * step;
  const height = PAD * 2 + NODE_H + Math.max(0, nextRow) * ROW_H;
  return { nodes: positioned, edges, width, height, step };
}
