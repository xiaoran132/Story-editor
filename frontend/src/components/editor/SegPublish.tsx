"use client";

import { NavBtns, DraftSlot } from "./fields";
import { usePublishChecks } from "./PublishCheck";
import styles from "./editor.module.css";
import type { SegProps } from "./segTypes";

// 第 6 段 · 发布体检。未过的项点「去补」直接跳到出问题的那一段。
export default function SegPublish({ go, names }: SegProps) {
  const checks = usePublishChecks();

  return (
    <>
          <>
            <p className={styles.desc}>
              发布前会做严格校验，全部通过后「发布」才可用；未通过的项可点击「前往修改」跳转到对应段落。
            </p>
            <div className={styles.checks}>
              {checks.map((c) => (
                <div
                  className={`${styles.check} ${c.ok ? styles.checkOk : ""}`}
                  key={c.label}
                >
                  <span className={styles.checkMark} aria-hidden="true">
                    {c.ok ? (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    ) : null}
                  </span>
                  {c.label}
                  {!c.ok && (
                    <button
                      className={styles.checkFix}
                      type="button"
                      onClick={() => go(c.step)}
                    >
                      前往修改 →
                    </button>
                  )}
                </div>
              ))}
            </div>
            <DraftSlot>
              发布成功后作品会出现在星海里。发布后仍停留在本页，可继续修改。
            </DraftSlot>
            <NavBtns index={5} names={names} onGo={go} />
          </>
    </>
  );
}
