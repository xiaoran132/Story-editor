import type { Option, StoryNode } from "./types";

// 后端把若干字段以 JSON 字符串返回，这里统一安全解析（解析失败给兜底值）。

export function parseJSON<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// current_state / state_snapshot → 属性对象
export function parseState(raw: string | null | undefined): Record<string, unknown> {
  return parseJSON<Record<string, unknown>>(raw, {});
}

// suggested_options → Option[]
export function parseOptions(raw: string | null | undefined): Option[] {
  const v = parseJSON<Option[]>(raw, []);
  return Array.isArray(v) ? v : [];
}

// 把属性值渲染成可读文本（set 类型是数组，scalar/number 直接展示）。
export function formatAttrValue(v: unknown): string {
  if (Array.isArray(v)) return v.length ? v.join("、") : "（空）";
  if (v === null || v === undefined) return "-";
  if (typeof v === "boolean") return v ? "是" : "否";
  return String(v);
}

// 续玩时后端只给全部 nodes 与 current_node_id；
// 从当前节点沿 parent_id 向根回溯，得到根→当前的有序路径，用于时间线渲染。
export function buildPath(
  nodes: StoryNode[],
  currentNodeId: string | null
): StoryNode[] {
  if (!currentNodeId) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: StoryNode[] = [];
  let cur = byId.get(currentNodeId);
  const guard = new Set<string>(); // 防御环
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    chain.push(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return chain.reverse();
}
