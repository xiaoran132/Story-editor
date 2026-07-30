import { attrLabel, formatAttrValue, formatDelta, parseState } from "@/lib/state";

export default function AttrBar({
  stateJSON,
  deltaJSON,
}: {
  stateJSON: string | null;
  deltaJSON?: string | null;
}) {
  const state = parseState(stateJSON);
  const delta = parseState(deltaJSON); // 本回合变化；开局/回溯为空对象
  const keys = Object.keys(state);
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
