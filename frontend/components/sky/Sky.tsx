import type { CSSProperties } from "react";
import Figure from "./Figure";
import { makeRng } from "@/lib/prng";
import type { FigurePose } from "@/lib/hue";

// 分层天空。13 份原型里 10 份在画天空、各写了一遍 —— 收敛成这一份，
// 各页只是取子集 + 换尺寸，用 props 开关。
//
// 层序**从底到顶固定**，换顺序会让剪影糊进云里、余光压不住地平线：
//   grad → halo → cloud → starfield → meteor → horizon → groundGlow → figure
//
// 消费方：星系卡（grad + star + 剪影）、编辑器「天空即完成度」（六段各点亮一层）、
// 草稿箱缩略（只画已点亮的层）、历史缩略、个人空间头图。
//
// ⚠️ 本组件不挂 --hue，也不自己算颜色：所有 --w-* 来自外层 <WorldScope>。
// 单独用它而不套 WorldScope，天空会落到 --hue 的 initial-value 252。

export type SkyLayers = {
  halo?: boolean;
  clouds?: boolean | 1 | 2 | 3;
  stars?: boolean | number;
  meteor?: boolean;
  horizon?: boolean;
  groundGlow?: boolean;
};

export type SkyProps = {
  /** 决定星点撒布 —— 同一个种子永远撒出同一张星图（禁 Math.random）。 */
  seed: number;
  pose?: FigurePose;
  layers?: SkyLayers;
  /** full = 铺满整屏：云换更亮的两档，渐变亮端翻到下方。 */
  scale?: "card" | "full";
  className?: string;
  style?: CSSProperties;
};

const DEFAULT_LAYERS: SkyLayers = {
  halo: true,
  clouds: 2,
  stars: 14,
  meteor: false,
  horizon: true,
  groundGlow: false,
};

export default function Sky({
  seed,
  pose,
  layers,
  scale = "card",
  className,
  style,
}: SkyProps) {
  const L = { ...DEFAULT_LAYERS, ...(layers ?? {}) };
  const cloudCount = L.clouds === true ? 2 : L.clouds === false ? 0 : (L.clouds ?? 0);
  const starCount = L.stars === true ? 14 : L.stars === false ? 0 : (L.stars ?? 0);

  // 星点在渲染时一次性算完：确定性 → 服务端与客户端产出同一串，不会水合失配。
  const rng = makeRng(seed);
  const stars = Array.from({ length: starCount }, (_, i) => ({
    key: i,
    left: `${(rng() * 96 + 1).toFixed(2)}%`,
    top: `${(rng() * 52 + 2).toFixed(2)}%`,
    size: rng() < 0.86 ? 1.6 : 2.2,
    opacity: (0.35 + rng() * 0.6).toFixed(2),
  }));

  return (
    <div
      className={className ? `wx-sky ${className}` : "wx-sky"}
      data-scale={scale}
      data-orient={scale === "full" ? "up" : "down"}
      style={style}
      aria-hidden="true"
    >
      <div className="wx-sky-grad" />
      {L.halo && <div className="wx-sky-halo" />}
      {Array.from({ length: cloudCount }, (_, i) => (
        <div key={`c${i + 1}`} className={`wx-cloud c${i + 1}`} />
      ))}
      {starCount > 0 && (
        <div className="wx-starfield">
          {stars.map((s) => (
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
      )}
      {L.meteor && (
        <span
          className="wx-streak"
          style={{ left: "14%", top: "13%", width: "46px" }}
        />
      )}
      {L.horizon && <div className="wx-horizon" />}
      {/* 余光不是装饰：没有它，近黑剪影会消失在深空底里。 */}
      {L.groundGlow && <div className="wx-ground-glow" />}
      {/* 剪影包一层定位盒：CSS 里 .wx-figure 负责位置与尺寸，.wx-figure svg 负责铺满。 */}
      {pose && (
        <span className="wx-figure">
          <Figure pose={pose} />
        </span>
      )}
    </div>
  );
}
