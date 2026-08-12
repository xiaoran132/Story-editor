// 编辑器步骤门禁的持久化。
//
// 门禁状态属于**作品**，不属于「这次是新建还是编辑」：作者走到第 3 步存了草稿、
// 关掉浏览器，明天再打开这部作品，第 5 步理应还锁着——走查没走完，换个入口不该
// 让它凭空作废。
//
// 存 localStorage 而不是后端：这是纯编辑器 UI 状态，塞进 world_config 会被下发给
// agent、混进作品 DTO，把界面进度变成领域数据。代价是不跨设备，0 用户阶段可以接受。
export interface Gate {
  maxUnlocked: number; // 已解锁到第几步（含）
  seen: number[]; // 离开过的步骤下标——「看完了」的依据，不是「到达过」
}

// 尚未保存的新作品还没有 id，先挂在这个占位键下，首次保存拿到 id 后搬过去。
export const NEW_GATE_ID = "new";

const key = (id: string) => `editorGate:${id}`;

export function readGate(id: string): Gate | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key(id));
    if (!raw) return null;
    const g = JSON.parse(raw);
    if (typeof g?.maxUnlocked !== "number" || !Array.isArray(g?.seen)) return null;
    return { maxUnlocked: g.maxUnlocked, seen: g.seen.filter((n: unknown) => typeof n === "number") };
  } catch {
    return null; // 坏数据当没有记录：大不了重走一遍，不能让编辑器打不开
  }
}

export function writeGate(id: string, g: Gate): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key(id), JSON.stringify(g));
  } catch {
    /* 隐私模式 / 配额满：门禁退化成不持久，不影响编辑 */
  }
}

// moveGate 在新作品首次保存拿到 id 时把占位记录搬过去，否则这次走查的进度会丢。
export function moveGate(from: string, to: string): void {
  const g = readGate(from);
  if (!g) return;
  writeGate(to, g);
  try {
    localStorage.removeItem(key(from));
  } catch {
    /* 同上 */
  }
}

// walkedGate 表示「这部作品已经走查完了」：全部解锁、全部看过。
// 用于本功能上线前就存在的作品——没有记录，总不能反过来把作者锁在自己的成品外面。
export const walkedGate = (steps: number): Gate => ({
  maxUnlocked: steps - 1,
  seen: Array.from({ length: steps }, (_, i) => i),
});
