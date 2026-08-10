"use client";

import { useEffect, useState } from "react";
import { parseOptions } from "@/lib/state";
import type { StoryNode } from "@/lib/types";
import { IconArrowRight } from "@/components/icons";

// 阅读态底部选项坞：编号选项（1/2/3 键盘可选）+ 自由输入 + 生成中 genbar。
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

  const pick = (i: number, text: string) => {
    if (busy) return;
    setCommitted(i);
    onChoose(text);
  };
  const submitFree = () => {
    const t = free.trim();
    if (!t || busy) return;
    setFree("");
    setCommitted(-1);
    onChoose(t);
  };

  useEffect(() => {
    if (!busy) setCommitted(null); // 新一段到达后复位高亮
  }, [busy, node?.id]);

  // 数字键 1/2/3 选项
  useEffect(() => {
    if (busy || ending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const n = Number(e.key);
      if (n >= 1 && n <= options.length) pick(n - 1, options[n - 1].text);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, ending, options]);

  // 生成中不再把选项整片换成一条 genbar —— 那样玩家看不到自己刚点了什么，
  // 也让 committed 高亮永远没机会出现。改为保留列表、禁用、把选中那条点亮，genbar 垫在下面。
  return (
    <>
      {!ending && (
        <div className={`choices${busy ? " busy" : ""}`}>
          {options.length > 0 ? (
            options.map((o, i) => (
              <button
                key={i}
                className={`choice${committed === i ? " committed" : ""}`}
                disabled={busy}
                onClick={() => pick(i, o.text)}
              >
                <span className="idx" aria-hidden="true">{i + 1}</span>
                {o.text}
                <span className="kbd" aria-hidden="true">{i + 1}</span>
              </button>
            ))
          ) : (
            <button className={`choice${committed === 0 ? " committed" : ""}`} disabled={busy} onClick={() => pick(0, "继续")}>
              <span className="idx" aria-hidden="true"><IconArrowRight size={13} /></span>
              继续
            </button>
          )}
        </div>
      )}

      {busy && (
        <div className="genbar" role="status">
          <span className="spin" aria-hidden="true" /> 正在生成剧情…
        </div>
      )}

      <div className="freein">
        <input
          type="text"
          placeholder={ending ? "故事已落幕" : options.length ? "或者，写下你自己的选择…" : "输入你的第一步行动…"}
          autoComplete="off"
          value={free}
          disabled={ending || busy}
          onChange={(e) => setFree(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitFree()}
          aria-label="写下你自己的选择"
        />
        <button className="send" disabled={ending || busy} onClick={submitFree} aria-label="继续">
          <IconArrowRight size={18} />
        </button>
      </div>
    </>
  );
}
