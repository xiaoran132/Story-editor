"use client";

import { useEffect, useState } from "react";
import { parseOptions } from "@/lib/state";
import type { StoryNode } from "@/lib/types";
import { IconArrowRight } from "@/components/icons";
import styles from "./OptionList.module.css";

// 选项与自由行动。1/2/3 数字键可选（原样保留）。
//
// ⚠️ 选项是**纯动作文本**，不带属性变化预测。原型的卡片上有一组 cost 角标，
// 但那个 hint 结构在 handoff §9.2 被明确否决过（剧透 + 让所有选择套路化），
// agent 侧的 normalize 至今还在防御性剥离它。别照抄回来。
//
// 自由输入上限 160 字（DESIGN §7.3）：再长就不是「一个动作」，是在替 AI 写剧情。

const MAX_INPUT = 160;

export default function OptionList({
  node,
  busy,
  onChoose,
}: {
  node: StoryNode | null;
  busy: boolean;
  onChoose: (text: string) => void;
}) {
  const [free, setFree] = useState("");
  const [committed, setCommitted] = useState<number | null>(null);
  const ending = node?.is_ending ?? true;
  const options = node ? parseOptions(node.suggested_options) : [];
  const over = free.trim().length > MAX_INPUT;

  const pick = (i: number, text: string) => {
    if (busy) return;
    setCommitted(i);
    onChoose(text);
  };

  const submitFree = () => {
    const t = free.trim();
    if (!t || busy || over) return;
    setFree("");
    setCommitted(-1);
    onChoose(t);
  };

  useEffect(() => {
    if (!busy) setCommitted(null); // 新一段到达后复位高亮
  }, [busy, node?.id]);

  // 数字键 1/2/3 选项。输入框里打字时不劫持——textarea 也要排除，
  // 否则在自由行动里敲 "1" 会直接替玩家做出选择。
  useEffect(() => {
    if (busy || ending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const n = Number(e.key);
      if (n >= 1 && n <= options.length) pick(n - 1, options[n - 1].text);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, ending, options]);

  return (
    <>
      {!ending && (
        <div className={styles.choices}>
          {options.length > 0 ? (
            options.map((o, i) => (
              <button
                key={i}
                className={`${styles.choice} ${committed === i ? styles.committed : ""}`}
                type="button"
                disabled={busy}
                onClick={() => pick(i, o.text)}
              >
                <span className={styles.idx} aria-hidden="true">
                  {i + 1}
                </span>
                <span className={styles.txt}>{o.text}</span>
              </button>
            ))
          ) : (
            <button
              className={`${styles.choice} ${committed === 0 ? styles.committed : ""}`}
              type="button"
              disabled={busy}
              onClick={() => pick(0, "继续")}
            >
              <span className={styles.idx} aria-hidden="true">
                <IconArrowRight size={13} />
              </span>
              <span className={styles.txt}>继续</span>
            </button>
          )}
        </div>
      )}

      <div className={styles.compose}>
        <label className="sr-only" htmlFor="free-action">
          写下你自己的行动
        </label>
        <textarea
          id="free-action"
          rows={1}
          value={free}
          disabled={ending || busy}
          placeholder={
            ending
              ? "故事已落幕"
              : options.length
                ? "或者，写下你自己的行动…"
                : "写下你的第一步行动…"
          }
          aria-describedby="free-action-note"
          aria-invalid={over || undefined}
          onChange={(e) => setFree(e.target.value)}
          onKeyDown={(e) => {
            // Enter 送出、Shift+Enter 换行：这一栏多数时候只写一句话
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submitFree();
            }
          }}
        />
        <button
          className={styles.send}
          type="button"
          disabled={ending || busy || !free.trim() || over}
          onClick={submitFree}
        >
          {busy ? "生成中…" : "继续"}
          {!busy && <IconArrowRight size={16} />}
        </button>
        <p className={`${styles.meter} ${over ? styles.over : ""}`} aria-live="polite">
          {free.trim().length} / {MAX_INPUT}
        </p>
        <p className={styles.note} id="free-action-note">
          写一个动作就好，别替 AI 写剧情——上限 {MAX_INPUT} 字。
        </p>
      </div>
    </>
  );
}
