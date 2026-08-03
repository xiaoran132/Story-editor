import { attrLabel, formatAttrValue, formatDelta, parseState } from "@/lib/state";

export default function AttrBar({
  stateJSON,
  deltaJSON,
  hiddenAttrs = [],
  revealGated = [],
  revealedAttrs = [],
}: {
  stateJSON: string | null;
  deltaJSON?: string | null;
  hiddenAttrs?: string[]; // 仅供 AI 参考的隐藏属性键：永不在玩家端展示
  revealGated?: string[]; // 揭示门控属性键：被揭示前不展示
  revealedAttrs?: string[]; // 本会话已揭示的门控属性键
}) {
  const state = parseState(stateJSON);
  const delta = parseState(deltaJSON); // 本回合变化；开局/回溯为空对象
  // 可见 = 非隐藏 ∧（非门控 ∨ 已揭示）
  const keys = Object.keys(state).filter(
    (k) =>
      !hiddenAttrs.includes(k) &&
      (!revealGated.includes(k) || revealedAttrs.includes(k))
  );
  if (!keys.length) return null;
  return (
    <div className="attrs">
      {keys.map((k) => {
        const badge = Object.prototype.hasOwnProperty.call(delta, k)
          ? formatDelta(delta[k])
          : null;
        const changed = badge !== null; // 有可展示的变化才高亮，忽略 0/空增量
        return (
          <div className={`attr${changed ? " changed" : ""}`} key={k}>
            <b>{attrLabel(k)}</b>
            <span className="val">{formatAttrValue(state[k])}</span>
            {badge ? <span className="delta">{badge}</span> : null}
          </div>
        );
      })}
    </div>
  );
}
