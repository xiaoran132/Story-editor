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
      {!ending && (
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

      <div className="free">
        <input
          type="text"
          placeholder="或输入你的自由行动…"
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
