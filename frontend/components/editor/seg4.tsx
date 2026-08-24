"use client";

import { useEditorStore } from "@/store/editorStore";
import { NavBtns, TextArea, TextField } from "./fields";
import styles from "./editor.module.css";
import type { SegProps } from "./segTypes";

// 第 4 段 · 开场。润色候选必须显式「采纳」才写入字段——未采纳不进作品、不进天空、不进草稿。
export default function Seg4({ go, names }: SegProps) {
  const s = useEditorStore();
  const anyBusy = s.aiBusy !== null || s.saving;
  const aiOpening = s.aiBusy === "opening";
  const aiPolish = s.aiBusy === "polish";
  const polishStale = s.polishSourceText !== null && s.openingContent !== s.polishSourceText;

  return (
    <>
          <>
            <p className={styles.desc}>
              开场正文会在进入游玩时逐字流出。写一个把人拽进去的钩子，别做背景说明。写够 40 字，剪影就会落位。
            </p>
            <div className={styles.row}>
              <button
                className={styles.btn}
                type="button"
                disabled={anyBusy}
                onClick={() => s.genOpening()}
              >
                {aiOpening ? "AI 生成中…" : "AI 生成开场"}
              </button>
            </div>
            <TextArea
              label="开场正文"
              hint="留空则由 AI 在开局时即时生成"
              rows={8}
              value={s.openingContent}
              onChange={(v) => s.setField("openingContent", v)}
            />
            <TextField
              label="润色目标"
              hint="（可选）针对完整开场正文，例如：让对白更有试探感"
              value={s.polishInstruction}
              onChange={s.setPolishInstruction}
            />
            <div className={styles.row}>
              <button
                className={styles.btn}
                type="button"
                disabled={anyBusy || !s.openingContent.trim()}
                onClick={() => s.polishOpening()}
              >
                {aiPolish ? "精品润色中…" : "精品润色"}
              </button>
            </div>

            {s.polishDraft !== null && (
              <div className={styles.field}>
                <span className={styles.label}>精品润色预览</span>
                {s.polishFeedback.length > 0 && (
                  <div className={styles.preview}>
                    {s.polishFeedback.slice(0, 2).map((issue, i) => (
                      <p className={styles.previewItem} key={`${issue.category}-${i}`}>
                        <strong>{issue.category}</strong> · {issue.span_hint}：{issue.goal}
                      </p>
                    ))}
                  </div>
                )}
                {!s.polishApplied ? (
                  <p className={styles.hint}>未发现高置信改进，已保留原文。</p>
                ) : (
                  <>
                    <TextArea label="改后正文" value={s.polishDraft} rows={8} readOnly />
                    {polishStale && <p className={styles.hint}>正文已变更，请重新润色后再采纳。</p>}
                    {/* 候选必须显式「采纳」才写入字段——未采纳不进作品、不进天空、不进草稿 */}
                    <div className={styles.row}>
                      <button
                        className={styles.btn}
                        type="button"
                        disabled={polishStale}
                        onClick={() => s.acceptPolish()}
                      >
                        替换开场正文
                      </button>
                      <button
                        className={`${styles.btn} ${styles.btnQuiet}`}
                        type="button"
                        onClick={() => s.dismissPolish()}
                      >
                        保留原稿
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {s.openingOptions.length > 0 && (
              <div className={styles.preview}>
                <p className={styles.hint}>起始选项预览（不入库，游玩时由 AI 生成）</p>
                {s.openingOptions.map((o, i) => (
                  <p className={styles.previewItem} key={i}>
                    {o.text}
                  </p>
                ))}
              </div>
            )}
            <NavBtns index={3} names={names} onGo={go} />
          </>
    </>
  );
}
