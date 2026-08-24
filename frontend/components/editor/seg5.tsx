"use client";

import { useEditorStore } from "@/store/editorStore";
import { FIGURE_POSES, THEME_PRESETS, type FigurePose } from "@/lib/hue";
import Figure from "@/components/sky/Figure";
import ImageUpload from "@/components/ImageUpload";
import { NavBtns, TextField } from "./fields";
import styles from "./editor.module.css";
import type { SegProps } from "./segTypes";

// 第 5 段 · 天空。**色相连续，不是几选一**——落库的是 {hue, figure} 的值，
// 预设只是选色器的便利项（plan.md §二·补）。
export default function Seg5({ go, names }: SegProps) {
  const s = useEditorStore();
  const setTheme = (patch: Partial<{ hue: number; figure: FigurePose }>) => {
    s.setField("theme", { ...s.theme, ...patch });
    s.setField("themePicked", true);
  };

  return (
    <>
          <>
            <p className={styles.desc}>
              这部作品的颜色。<strong>色相是连续的，不是几选一</strong>——预设只是起点，选完还能自己拖。
              选定后云层与流星痕会亮起来。
            </p>

            <div className={styles.field}>
              <span className={styles.label}>预设</span>
              <div className={styles.presets}>
                {THEME_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={styles.preset}
                    aria-pressed={s.theme.hue === p.hue && s.theme.figure === p.figure}
                    onClick={() => setTheme({ hue: p.hue, figure: p.figure })}
                  >
                    <span
                      className={styles.presetChip}
                      style={{
                        background: `linear-gradient(180deg, oklch(0.34 0.115 ${p.hue}), oklch(0.11 0.04 ${p.hue}))`,
                      }}
                    />
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="wx-hue-range">
                色相 <span className={styles.hint}>0–360，随作品落库</span>
              </label>
              <div className={styles.hueRow}>
                <input
                  id="wx-hue-range"
                  type="range"
                  min={0}
                  max={359}
                  value={s.theme.hue}
                  onChange={(e) => setTheme({ hue: Number(e.target.value) })}
                />
                <span className={styles.hueVal}>{s.theme.hue}°</span>
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>
                剪影姿态 <span className={styles.hint}>站在这个世界地平线上的那个人</span>
              </span>
              <div className={styles.poses}>
                {FIGURE_POSES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={styles.pose}
                    aria-pressed={s.theme.figure === p}
                    aria-label={`剪影姿态 ${p}`}
                    onClick={() => setTheme({ figure: p })}
                  >
                    <Figure pose={p} />
                  </button>
                ))}
              </div>
            </div>

            <ImageUpload
              kind="cover"
              value={s.coverUrl}
              onChange={(url) => s.setField("coverUrl", url)}
              label="封面图"
              hint="（可选）不传就用这片天空当封面——无图是默认态，不是降级态"
            />

            <TextField
              label="推荐续写模型"
              hint="仅作展示，玩家不会被自动套用"
              value={s.recWriteModel}
              onChange={(v) => s.setField("recWriteModel", v)}
            />
            <TextField
              label="推荐审校模型"
              hint="同上"
              value={s.recReviewModel}
              onChange={(v) => s.setField("recReviewModel", v)}
            />
            <NavBtns index={4} names={names} onGo={go} />
          </>
    </>
  );
}
