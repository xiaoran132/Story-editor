import { attrLabel, formatAttrValue, formatDelta, parseState } from "@/lib/state";

// 阅读态左轨「状态」面板：可见属性 = 非 hidden ∧（非 reveal 门控 ∨ 已揭示）。
// 进度条只画给**声明了 max 的 number 属性**（attrMax）——没有上限就没有「满」的概念，
// 硬按 0–100 画会让 gold:500 永远满格、affinity:-20 永远空格，比不画更误导。
// set 类属性（数组）归入「随身」，多于一个时带上键名，否则两组物品会糊成一片。
export default function AttrBar({
  stateJSON,
  deltaJSON,
  hiddenAttrs = [],
  revealGated = [],
  revealedAttrs = [],
  attrMax = {},
}: {
  stateJSON: string | null;
  deltaJSON?: string | null;
  hiddenAttrs?: string[];
  revealGated?: string[];
  revealedAttrs?: string[];
  attrMax?: Record<string, number>;
}) {
  const state = parseState(stateJSON);
  const delta = parseState(deltaJSON);
  const keys = Object.keys(state).filter(
    (k) =>
      !hiddenAttrs.includes(k) &&
      (!revealGated.includes(k) || revealedAttrs.includes(k))
  );

  // set 类属性（数组值）单独作「随身」；其余作属性行。
  const invKeys = keys.filter((k) => Array.isArray(state[k]));
  const attrKeys = keys.filter((k) => !Array.isArray(state[k]));
  // 门控但未揭示的键：作锁定占位，暗示「剧情中会显现」。
  const lockedKeys = revealGated.filter(
    (k) => !revealedAttrs.includes(k) && !hiddenAttrs.includes(k)
  );

  return (
    <>
      <div className="panel">
        <h2>状态</h2>
        {attrKeys.length === 0 && lockedKeys.length === 0 ? (
          <p className="od-locked">尚无可见状态</p>
        ) : (
          <>
            {attrKeys.map((k) => {
              const v = state[k];
              const max = attrMax[k];
              const pct =
                typeof v === "number" && max > 0
                  ? Math.max(0, Math.min(100, (v / max) * 100))
                  : null;
              const badge = Object.prototype.hasOwnProperty.call(delta, k) ? formatDelta(delta[k]) : null;
              const up = badge?.startsWith("+");
              return (
                <div className="od-attr" key={k}>
                  <div className="row">
                    <b>{attrLabel(k)}</b>
                    <span>{formatAttrValue(v)}</span>
                  </div>
                  {pct !== null && (
                    <div className="od-bar">
                      <i style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  {badge && <span className={`od-delta ${up ? "up" : "down"} run`}>{badge}</span>}
                </div>
              );
            })}
            {lockedKeys.map((k) => (
              <div className="od-attr" key={k}>
                <div className="od-locked">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                  {attrLabel(k)} · 尚未显现
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {invKeys.length > 0 && (
        <div className="panel">
          <h2>随身</h2>
          {invKeys.map((k) => {
            const arr = (state[k] as unknown[]).map(String);
            return (
              <div key={k} className="od-invgroup">
                {invKeys.length > 1 && <span className="gk">{attrLabel(k)}</span>}
                <div className="od-inv">
                  {arr.length ? arr.map((it, i) => <span key={i}>{it}</span>) : <span className="od-locked">空</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
