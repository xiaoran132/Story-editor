"use client";

import { useState } from "react";
import { parseOptions } from "@/lib/state";
import type { StoryNode } from "@/lib/types";

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
  const ending = node?.is_ending ?? true; // 无节点时也禁用
  const options = node ? parseOptions(node.suggested_options) : [];

  const submitFree = () => {
    const t = free.trim();
    if (!t) return;
    onChoose(t);
    setFree("");
  };

  return (
    <>
      {!ending && !busy && options.length > 0 && (
        <div className="options">
          {options.map((o, i) => (
            <button
              key={i}
              className="opt"
              disabled={busy}
              onClick={() => onChoose(o.text)}
            >
              {o.text}
              {o.hint ? <span className="hint">（{o.hint}）</span> : null}
            </button>
          ))}
        </div>
      )}

      {/* 纯叙事过场（无选项、非结局）：给一个「继续」让剧情往下流，无需玩家硬想输入 */}
      {!ending && !busy && options.length === 0 && (
        <div className="options">
          <button className="opt continue" onClick={() => onChoose("继续")}>
            继续 ▸
          </button>
        </div>
      )}

      <div className="free">
        <input
          type="text"
          placeholder={
            options.length ? "或输入你的自由行动…" : "输入你的第一步行动…"
          }
          autoComplete="off"
          value={free}
          disabled={busy || ending}
          onChange={(e) => setFree(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitFree();
          }}
        />
        <button disabled={busy || ending} onClick={submitFree}>
          行动
        </button>
      </div>
    </>
  );
}
