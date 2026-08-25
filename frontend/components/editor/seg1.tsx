"use client";

import { useState } from "react";
import { useEditorStore } from "@/store/editorStore";
import { NavBtns, TextArea, TextField } from "./fields";
import styles from "./editor.module.css";
import type { SegProps } from "./segTypes";

// 第 1 段 · 灵感。灵感与风格是**本段的临时输入**，不进作品数据——
// 它们只是喂给 AI 的一次提示，采纳与否由生成结果决定。
export default function Seg1({ go, names }: SegProps) {
  const s = useEditorStore();
  const [idea, setIdea] = useState("");
  const [ideaStyle, setIdeaStyle] = useState("");
  const anyBusy = s.aiBusy !== null || s.saving;
  const aiWorld = s.aiBusy === "world";

  return (
    <>
          <>
            <p className={styles.desc}>
              先写下最模糊的那点冲动——一个场景、一句台词、一种氛围。AI 会把它扩写成完整世界观，你再回来改。
            </p>
            <TextArea
              label="灵感"
              rows={3}
              value={idea}
              onChange={setIdea}
              placeholder="例：民国上海，一桩密室命案，侦探须在三日内破案…"
            />
            <TextField
              label="风格"
              hint="（可选）"
              value={ideaStyle}
              onChange={setIdeaStyle}
              placeholder="如 本格推理 / 冷峻"
            />
            <div className={styles.row}>
              <button
                className={styles.btn}
                type="button"
                disabled={anyBusy}
                onClick={() => {
                  s.genWorld(idea, ideaStyle);
                  go(1); // 生成结果落在世界观那段，直接把作者带过去看
                }}
              >
                {aiWorld ? "AI 构思中…" : "AI 生成世界观"}
              </button>
            </div>
            <p className={styles.desc}>
              这一段的完成判定是<strong>钩子 ≥8 字且已选题材</strong>——它点亮地平线。钩子写在下一段的「简介」。
            </p>
            <NavBtns index={0} names={names} onGo={go} />
          </>
    </>
  );
}
