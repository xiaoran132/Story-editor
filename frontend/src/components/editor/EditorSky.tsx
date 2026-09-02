"use client";

import type { CSSProperties } from "react";
import Figure from "@/components/sky/Figure";
import WorldScope from "@/components/sky/WorldScope";
import { makeRng } from "@/lib/prng";
import type { Theme } from "@/lib/hue";
import type { AttrRowData } from "@/lib/types";
import styles from "./editor.module.css";

// 「天空即完成度」——进度不由进度条表示，**进度就是那片天空**（DESIGN.md §7.7）。
// 六段各点亮一层，层与段一一对应；某段没写完，天空就缺那一层，不需要读错误列表
// 才知道还差什么。
//
// ⚠️ 每一层单独看都必须有肉眼可辨的变化。规格里那张表记的是首版翻过的车：
//   L1 用 --w-ink(0.055) 压在 0.075 的底上，ΔL 0.02 = 等于没画，还把剪影一起吃掉；
//   L2 30 颗 1.5px 撒在整块预览上，肉眼无感；
//   L5 用 §4 的 --w-cloud(0.20) 压在 --w-sky-md(0.22) 上，是**负对比**。
// 所以本组件的这几个值是页面级的，不取 §4 那几档小卡片用的 token——照抄会重蹈覆辙。

export type SegReady = [boolean, boolean, boolean, boolean, boolean, boolean];

export type EditorSkyProps = {
  theme: Theme;
  ready: SegReady;
  /** 属性星是语义元素：一个属性一颗，数量由作品决定，不能为了「够亮」注水。 */
  attrs: AttrRowData[];
  /** 减动效：取消点亮过渡、虚线环自转与流星，静止态即最终态。 */
  reduced?: boolean;
};

// L2 环境星点：120 颗 × 1.9px（22% 放大到 2.7px），线性同余种子 9301，刷新一致。
const AMBIENT_STARS = (() => {
  const rng = makeRng(9301);
  return Array.from({ length: 120 }, (_, i) => ({
    key: i,
    left: `${(rng() * 100).toFixed(2)}%`,
    top: `${(rng() * 62).toFixed(2)}%`,
    size: rng() < 0.78 ? 1.9 : 2.7,
    opacity: (0.3 + rng() * 0.62).toFixed(2),
  }));
})();

/**
 * 属性星的位置：**横向等分列 + hue 决定纵向**，确定性布局，不用 Math.random()。
 * 纵向掺进序号，避免同一部作品的星排成一条水平线。
 */
function attrStarPos(index: number, total: number, hue: number) {
  const left = ((index + 0.5) / Math.max(1, total)) * 100;
  const top = 16 + ((hue + index * 47) % 100) * 0.3;
  return { left: `${left.toFixed(2)}%`, top: `${top.toFixed(2)}%` };
}

export default function EditorSky({ theme, ready, attrs, reduced }: EditorSkyProps) {
  // hidden 的属性**根本不上天**：它的契约是仅供 AI 参考，玩家永不可见——
  // 在作者的进度天空上给它一颗星，等于把「有个隐藏变量」画成了可见成果。
  // 字段旁另有注明，那里才是它该出现的地方。
  const skyAttrs = attrs.filter((a) => a.key.trim() && !a.hidden);

  return (
    <WorldScope
      hue={theme.hue}
      className={styles.sky}
      style={{ "--sky-reduced": reduced ? 1 : 0 } as CSSProperties}
      data-reduced={reduced ? "1" : undefined}
    >
      {/* 段 2：渐变天空。整片天的底，先于其它层出现 */}
      <div className={styles.skyGrad} data-on={ready[1] ? "1" : undefined} />

      {/* 段 5：云。移到中段天空（44% / 56%），底部让给辉光与剪影 */}
      <div className={`${styles.skyCloud} ${styles.cloudA}`} data-on={ready[4] ? "1" : undefined} />
      <div className={`${styles.skyCloud} ${styles.cloudB}`} data-on={ready[4] ? "1" : undefined} />

      {/* 段 2：环境星点 */}
      <div className={styles.skyStars} data-on={ready[1] ? "1" : undefined}>
        {AMBIENT_STARS.map((s) => (
          <i
            key={s.key}
            style={{
              left: s.left,
              top: s.top,
              width: `${s.size}px`,
              height: `${s.size}px`,
              opacity: s.opacity,
            }}
          />
        ))}
      </div>

      {/* 段 3：属性星。可见属性 = 一颗亮星；reveal = 不发光的虚线待亮环，17s 自转 */}
      <div className={styles.attrStars} data-on={ready[2] ? "1" : undefined}>
        {skyAttrs.map((a, i) => {
          const p = attrStarPos(i, skyAttrs.length, theme.hue);
          return (
            <span
              key={`${a.key}-${i}`}
              className={a.reveal ? styles.attrStarWait : styles.attrStar}
              style={{ left: p.left, top: p.top }}
            >
              <b aria-hidden="true" />
              <em>{a.key.trim()}</em>
            </span>
          );
        })}
      </div>

      {/* 段 5：流星痕（静态的一道痕，与段 6 那道会跑的流星不是一回事） */}
      <div className={styles.skyStreak} data-on={ready[4] ? "1" : undefined} />

      {/* 段 1：地平线辉光带。**不是一条线**——真实天空本就地平线最亮，
          四档渐变合成后 ΔL≈0.18，同时给纯黑剪影一个站得住的背衬 */}
      <div className={styles.skyHorizon} data-on={ready[0] ? "1" : undefined} />

      {/* 段 4：剪影落位。由 L1 的辉光带背衬，ΔL≈0.20 */}
      <div className={styles.skyFigure} data-on={ready[3] ? "1" : undefined}>
        <Figure pose={theme.figure} />
      </div>

      {/* 段 6：体检全过时划过的那一道。一次性，减动效下不播 */}
      {ready[5] && !reduced && <span className={styles.skyMeteor} />}
    </WorldScope>
  );
}
