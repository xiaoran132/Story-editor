import { attrLabel, formatAttrValue, formatDelta, parseState } from "@/lib/state";
import styles from "./AttrBar.module.css";

// 「此刻的你」——属性三态面板。
// 可见属性 = 非 hidden ∧（非 reveal 门控 ∨ 已揭示）。
// hidden 的键**整条不出现**：它的契约是仅供 AI 参考，连它存在都不该让玩家知道。
// 进度条只画给声明了 max 的 number 属性（attrMax），理由见 CSS 里的注释。
// set 类属性（数组）归入「随身」，多于一组时带上键名，否则两组物品会糊成一片。
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
    (k) => !hiddenAttrs.includes(k) && (!revealGated.includes(k) || revealedAttrs.includes(k)),
  );

  const invKeys = keys.filter((k) => Array.isArray(state[k]));
  const attrKeys = keys.filter((k) => !Array.isArray(state[k]));
  // 门控但未揭示的键：作锁定占位，明说「剧情中会显现」但不泄露值。
  const lockedKeys = revealGated.filter(
    (k) => !revealedAttrs.includes(k) && !hiddenAttrs.includes(k),
  );

  const nothing = attrKeys.length === 0 && lockedKeys.length === 0 && invKeys.length === 0;

  return (
    <>
      {nothing ? (
        <p className={styles.empty}>尚无可见状态</p>
      ) : (
        <>
          {attrKeys.map((k) => {
            const v = state[k];
            const max = attrMax[k];
            const pct =
              typeof v === "number" && max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : null;
            const changed = Object.prototype.hasOwnProperty.call(delta, k);
            const badge = changed ? formatDelta(delta[k]) : null;
            const down = badge?.startsWith("-");
            return (
              <div className={`${styles.attr} ${changed ? styles.just : ""}`} key={k}>
                <div className={styles.row}>
                  <span className={styles.k}>{attrLabel(k)}</span>
                  <span className={styles.v}>
                    {formatAttrValue(v)}
                    {badge && (
                      <em className={`${styles.delta} ${down ? styles.deltaDown : ""}`}>{badge}</em>
                    )}
                  </span>
                </div>
                {pct !== null && (
                  <div className={styles.bar}>
                    <i style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
            );
          })}

          {lockedKeys.map((k) => (
            <div className={styles.attr} key={k}>
              <p className={styles.locked}>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <rect x="4" y="11" width="16" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                {attrLabel(k)} · 尚未显现
              </p>
            </div>
          ))}

          {invKeys.length > 0 && (
            <div className={styles.group}>
              <h3 className={styles.groupTitle}>随身</h3>
              {invKeys.map((k) => {
                const arr = (state[k] as unknown[]).map(String);
                return (
                  <div key={k}>
                    {invKeys.length > 1 && <span className={styles.setKey}>{attrLabel(k)}</span>}
                    <div className={styles.set}>
                      {arr.length ? (
                        arr.map((it, i) => <span key={i}>{it}</span>)
                      ) : (
                        <span className={styles.empty}>空</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}
