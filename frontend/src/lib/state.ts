import type { Option, StoryNode } from "./types";

// 后端把若干字段以 JSON 字符串返回，这里统一安全解析（解析失败给兜底值）。

function parseJSON<T>(raw: string | null | undefined, fallback: T): T {
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
// 关键：对象也要优雅兜底——未声明类型的属性若被合并成 {add,remove} 形态，
// 直接 String() 会渲染成 "[object Object]"，这里拆开展示。
export function formatAttrValue(v: unknown): string {
  if (Array.isArray(v)) return v.length ? v.map(formatAttrValue).join("、") : "（空）";
  if (v === null || v === undefined) return "-";
  if (typeof v === "boolean") return v ? "是" : "否";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    // set 增量形态 {add:[...], remove:[...]}
    if (Array.isArray(o.add) || Array.isArray(o.remove)) {
      const parts: string[] = [];
      if (Array.isArray(o.add) && o.add.length) parts.push(`+${o.add.join("、")}`);
      if (Array.isArray(o.remove) && o.remove.length) parts.push(`-${o.remove.join("、")}`);
      return parts.length ? parts.join(" ") : "（空）";
    }
    // 一般对象：键值平铺，键也走中文标签
    const entries = Object.entries(o);
    if (!entries.length) return "（空）";
    return entries.map(([k, val]) => `${attrLabel(k)}：${formatAttrValue(val)}`).join("、");
  }
  return String(v);
}

// 常见属性键 → 中文标签。HP/MP 等约定俗成的保留原样；未收录的键回落原文。
// 更长期的正解是让创作者在 world_config.attributes 里声明 label，由后端下发（见交接手册）。
const ATTR_LABELS: Record<string, string> = {
  hp: "HP", mp: "MP", exp: "经验", level: "等级",
  gold: "金币", money: "金钱", credits: "信用点", coin: "铜钱",
  water: "饮水", food: "食物", energy: "体力", stamina: "耐力", fuel: "燃料", ammo: "弹药",
  sanity: "理智", morale: "士气", mood: "心情",
  reputation: "声望", fame: "名望", karma: "业力", honor: "荣誉",
  favor: "好感", affection: "好感度", trust: "信任", relationship: "关系",
  internal_power: "内力", qi: "真气", mana: "法力", magic: "魔力",
  heat: "警戒度", alert: "警戒", risk: "风险", danger: "危险度", suspicion: "怀疑度",
  location: "位置", place: "地点", region: "区域", time: "时间", day: "天数", turn: "回合",
  items: "物品", inventory: "背包", equipment: "装备", skills: "技能", abilities: "能力",
  implants: "义体", allies: "盟友", clues: "线索", flags: "标记", achievements: "成就",
  health: "生命", strength: "力量", agility: "敏捷", intelligence: "智力", charm: "魅力",
};

export function attrLabel(key: string): string {
  const k = key.toLowerCase();
  if (ATTR_LABELS[k]) return ATTR_LABELS[k];
  return key.replace(/_/g, " "); // 未收录：至少把下划线换成空格，别顶着 snake_case
}

// 把某属性本回合的变化（state_delta 里的值）转成展示徽标。
// number → 带符号数值；set → +新增/-移除；scalar/其它 → 标「更新」。返回 null 表示无需展示。
export function formatDelta(deltaVal: unknown): string | null {
  if (deltaVal === null || deltaVal === undefined) return null;
  if (typeof deltaVal === "number") {
    if (deltaVal === 0) return null; // 无变化（模型偶尔多带的 0 键），不展示
    return deltaVal > 0 ? `+${deltaVal}` : `${deltaVal}`;
  }
  if (typeof deltaVal === "object") {
    const o = deltaVal as Record<string, unknown>;
    if (Array.isArray(o.add) || Array.isArray(o.remove)) {
      const parts: string[] = [];
      if (Array.isArray(o.add)) o.add.forEach((x) => parts.push(`+${x}`));
      if (Array.isArray(o.remove)) o.remove.forEach((x) => parts.push(`-${x}`));
      return parts.length ? parts.join(" ") : null;
    }
    return "更新";
  }
  return "更新"; // scalar 覆盖：新值已在主体展示，这里只标记「变了」
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
