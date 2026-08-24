import type { CSSProperties } from "react";
import type { FigurePose } from "@/lib/hue";

// 六姿态剪影。`viewBox="0 0 100 92"`，纯 currentColor —— 颜色交给容器
// （.wx-figure 设 color: var(--w-ink)），组件自己不写死任何色值。
//
// 头 + 躯干 + 腿是共用件，**新增姿态只改四肢 stroke**（DESIGN.md §8）。
// 原型里这份生成器在多页各存了一份拷贝，这里收敛成唯一一份。
//
// ⚠️ 剪影是 L 0.055 的近黑，必须有地平线余光垫在下面才读得出轮廓，
// 否则它会整个消失在深空底里（见 Sky 的 groundGlow 层）。

const HEAD = "M50 22c-5.4 0-9.4 3.6-10.1 8.7l-1.7 12.9c-.3 2.3 1.5 4.2 3.8 4.2h16c2.3 0 4.1-1.9 3.8-4.2l-1.7-12.9C59.4 25.6 55.4 22 50 22z";

const LEGS_STAND = [
  "M45.6 47 43.6 80",
  "M54.4 47 56.4 80",
];

const LEGS_WALK = [
  "M45.6 47 40 79",
  "M54.4 47 61 78",
];

type Limb = { d: string; width: number; join?: "round" };

const ARMS: Record<FigurePose, Limb[]> = {
  gaze: [
    { d: "M41 30 35 49", width: 5 },
    { d: "M59 30 66 47", width: 5 },
  ],
  radio: [
    { d: "M41 30 36 50", width: 5 },
    { d: "M59 31 64 38 57 23", width: 5, join: "round" },
  ],
  blade: [
    { d: "M41 30 36 50", width: 5 },
    { d: "M59 30 64 50", width: 5 },
    { d: "M64 52 72 16", width: 2.6 },
  ],
  umbrella: [
    { d: "M41 30 36 50", width: 5 },
    { d: "M59 30 63 19", width: 5 },
    { d: "M63 19 63 8", width: 2.2 },
  ],
  reach: [
    { d: "M41 30 29 19", width: 5 },
    { d: "M59 30 71 19", width: 5 },
  ],
  walk: [
    { d: "M41 30 45 49", width: 5 },
    { d: "M59 30 55 49", width: 5 },
  ],
};

export type FigureProps = {
  pose: FigurePose;
  className?: string;
  style?: CSSProperties;
};

export default function Figure({ pose, className, style }: FigureProps) {
  // gaze 的头略偏，视线才读得出「在仰望」
  const headCx = pose === "gaze" ? 49 : 50;
  const headCy = pose === "gaze" ? 13 : 14;
  const legs = pose === "walk" ? LEGS_WALK : LEGS_STAND;

  return (
    <svg viewBox="0 0 100 92" aria-hidden="true" className={className} style={style}>
      <g fill="currentColor" stroke="currentColor">
        <circle cx={headCx} cy={headCy} r={7.4} />
        <path d={HEAD} />
        {legs.map((d) => (
          <path key={d} d={d} strokeWidth={6} strokeLinecap="round" fill="none" />
        ))}
        {ARMS[pose].map((limb) => (
          <path
            key={limb.d}
            d={limb.d}
            strokeWidth={limb.width}
            strokeLinecap="round"
            strokeLinejoin={limb.join}
            fill="none"
          />
        ))}
        {/* 手持物：收音机是个小方块，伞是一片顶篷。两者都是实心填充件，不走 stroke。 */}
        {pose === "radio" && <rect x={53} y={15} width={6} height={9} rx={1.4} />}
        {pose === "umbrella" && <path d="M47 12q16-13 32 0z" />}
      </g>
    </svg>
  );
}
