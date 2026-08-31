"use client";

import { useEditorStore } from "@/store/editorStore";
import { GENRES, TONES } from "@/lib/types";
import type { StyleProfile } from "@/lib/types";
import CharacterList from "./CharacterList";
import { NavBtns, SelectField, TextArea, TextField } from "./fields";
import styles from "./editor.module.css";
import type { SegProps } from "./segTypes";

// 第 2 段 · 世界观。
// tags 的单一事实源是 store 里的数组，UI 只做增删排序，**不认识的标签原样保留**——
// AI 生成或作者手填的「民国」「本格」这类不在建议表里，抹掉就是数据丢失。
// 排序约定：题材在前（tags[0] 决定归类）、自定义居中、基调置尾。
export default function Seg2({ go, names }: SegProps) {
  const s = useEditorStore();
  // styleProfile 是嵌套对象，而 setField 只能整键替换（editorStore.setField），
  // 所以走 seg5 setTheme 那套 spread-patch，不必给 store 加专用 action。
  const sp = (patch: Partial<StyleProfile>) =>
    s.setField("styleProfile", { ...s.styleProfile, ...patch });
  // 逗号分隔 ↔ string[]，同吃中英文逗号——沿用 AttrTable 里 set 型初值的写法。
  const toList = (text: string) =>
    text.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
  const isGenre = (t: string) => (GENRES as readonly string[]).includes(t);
  const isTone = (t: string) => (TONES as readonly string[]).includes(t);
  const extraTags = s.tags.filter((t) => !isGenre(t) && !isTone(t));
  const reorder = (list: string[]) => [
    ...GENRES.filter((g) => list.includes(g)),
    ...list.filter((t) => !isGenre(t) && !isTone(t)),
    ...list.filter(isTone),
  ];
  const toggleGenre = (g: string) =>
    s.setField("tags", reorder(s.tags.includes(g) ? s.tags.filter((t) => t !== g) : [...s.tags, g]));
  const setTone = (tone: string) =>
    s.setField("tags", reorder([...s.tags.filter((t) => !isTone(t)), ...(tone ? [tone] : [])]));

  return (
    <>
          <>
            <p className={styles.desc}>
              这段会作为系统设定用于每一次生成，请写清世界如何运转、玩家是谁、哪些不可违背。
            </p>
            <TextField label="标题" value={s.title} onChange={(v) => s.setField("title", v)} />
            <TextArea
              label="一句话钩子"
              hint="卡片上那一句，也是天空第一层的判定（≥8 字）"
              rows={2}
              value={s.description}
              onChange={(v) => s.setField("description", v)}
            />
            <TextArea label="背景" value={s.background} onChange={(v) => s.setField("background", v)} />
            <TextField label="基调" value={s.style} onChange={(v) => s.setField("style", v)} />

            {/* 文风档案：玩家每回合的正文都按它写（agent 侧只喂写手，不喂结构化与审校）。
                全部可选、全空则整个键不写入 world_config，所以不参与完成度与发布校验。 */}
            <div className={styles.field}>
              <span className={styles.label}>
                文风档案 <span className={styles.hint}>（可选）约束玩家读到的正文；AI 生成世界观时会一并给出，可在此微调</span>
              </span>
            </div>
            <SelectField
              label="叙事距离"
              value={s.styleProfile.narrative_distance ?? ""}
              onChange={(v) => sp({ narrative_distance: (v || undefined) as StyleProfile["narrative_distance"] })}
              options={[
                { value: "", label: "（不指定）" },
                { value: "close", label: "紧贴 · 贴近主角内心与感官" },
                { value: "medium", label: "适中" },
                { value: "distant", label: "疏离 · 冷眼旁观的镜头感" },
              ]}
            />
            <SelectField
              label="叙事节奏"
              value={s.styleProfile.rhythm ?? ""}
              onChange={(v) => sp({ rhythm: (v || undefined) as StyleProfile["rhythm"] })}
              options={[
                { value: "", label: "（不指定）" },
                { value: "mixed", label: "张弛交替" },
                { value: "tight", label: "紧凑推进" },
                { value: "relaxed", label: "舒缓铺陈" },
              ]}
            />
            <TextField
              label="感官侧重"
              hint="逗号分隔，最多 3 条，每条 ≤48 字。如 听觉, 气味"
              value={(s.styleProfile.sensory_focus ?? []).join("，")}
              onChange={(v) => sp({ sensory_focus: toList(v) })}
            />
            <TextField
              label="对白规则"
              hint="≤160 字。如 对白短促，多留白，不解释动机"
              value={s.styleProfile.dialogue_rule ?? ""}
              onChange={(v) => sp({ dialogue_rule: v })}
            />
            <TextField
              label="避免"
              hint="逗号分隔，最多 5 条，每条 ≤48 字。写具体的写法，如 上帝视角, 形容词堆砌"
              value={(s.styleProfile.avoid ?? []).join("，")}
              onChange={(v) => sp({ avoid: toList(v) })}
            />
            <TextArea label="规则" value={s.rules} onChange={(v) => s.setField("rules", v)} />
            <TextArea
              label="大纲"
              hint="AI 导演的走向锚点，非线性脚本"
              rows={4}
              value={s.outline}
              onChange={(v) => s.setField("outline", v)}
            />

            <div className={styles.field}>
              <span className={styles.label}>
                题材 <span className={styles.hint}>可多选；第一个决定作品在星海与作品馆中的分类</span>
              </span>
              <div className={styles.chips}>
                {GENRES.map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={styles.chip}
                    aria-pressed={s.tags.includes(g)}
                    onClick={() => toggleGenre(g)}
                  >
                    {g}
                  </button>
                ))}
              </div>
              {extraTags.length > 0 && (
                <p className={styles.hint}>
                  另有自定义标签：{extraTags.join("、")}（AI 生成或手动输入，原样保留）
                </p>
              )}
            </div>

            <SelectField
              label="基调标签"
              value={s.tags.find(isTone) ?? ""}
              onChange={setTone}
              options={[
                { value: "", label: "（不指定）" },
                ...TONES.map((t) => ({ value: t, label: t })),
              ]}
            />

            <CharacterList />
            <NavBtns index={1} names={names} onGo={go} />
          </>
    </>
  );
}
