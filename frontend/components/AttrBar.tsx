import { attrLabel, formatAttrValue, formatDelta, parseState } from "@/lib/state";

export default function AttrBar({
  stateJSON,
  deltaJSON,
  hiddenAttrs = [],
  revealGated = [],
  revealedAttrs = [],
  turn,
  explored,
}: {
  stateJSON: string | null;
  deltaJSON?: string | null;
  hiddenAttrs?: string[]; // 仅供 AI 参考的隐藏属性键：永不在玩家端展示
  revealGated?: string[]; // 揭示门控属性键：被揭示前不展示
  revealedAttrs?: string[]; // 本会话已揭示的门控属性键
  turn?: number; // 已推进回合数（会话 node_count）
  explored?: number; // 已探索节点总数（含分支）
}) {
  const state = parseState(stateJSON);
  const delta = parseState(deltaJSON); // 本回合变化；开局/回溯为空对象
  // 可见 = 非隐藏 ∧（非门控 ∨ 已揭示）
  const keys = Object.keys(state).filter(
    (k) =>
      !hiddenAttrs.includes(k) &&
      (!revealGated.includes(k) || revealedAttrs.includes(k))
  );
  return (
    <aside className="rail">
      <div className="rail-head">
        {/* 占位头像：未来放主角头像 / 任务入口 */}
        <div className="avatar" aria-hidden="true">
          ✦
        </div>
        <div className="rail-head-text">
          <span className="eyebrow">状态</span>
          <span className="rail-sub">主角</span>
        </div>
      </div>
      {keys.length ? (
        <ul className="attr-list">
          {keys.map((k) => {
            const badge = Object.prototype.hasOwnProperty.call(delta, k)
              ? formatDelta(delta[k])
              : null;
            const changed = badge !== null; // 有可展示的变化才高亮，忽略 0/空增量
            return (
              <li className={`attr-row${changed ? " changed" : ""}`} key={k}>
                <span className="attr-k">{attrLabel(k)}</span>
                <span className="attr-v">{formatAttrValue(state[k])}</span>
                {badge ? <span className="attr-d">{badge}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rail-empty">尚无可见状态</p>
      )}

      {(turn != null || explored != null) && (
        <div className="rail-meta">
          {turn != null && (
            <div className="rail-meta-item">
              <span>回合</span>
              <b>{turn}</b>
            </div>
          )}
          {explored != null && (
            <div className="rail-meta-item">
              <span>已探索</span>
              <b>{explored}</b>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
