"use client";

import Link from "next/link";
import Backdrop from "@/components/sky/Backdrop";
import Figure from "@/components/sky/Figure";
import WxHeader from "@/components/wx/WxHeader";
import styles from "./not-found.module.css";

// 404 · 掉出星空。规格 DESIGN.md §7.12，视觉目标 docs/design/404.html。
//
// **404 不是错误提示，是一次坠落。** 在这套世界观里，一个空地址不是 bug，是一片
// 还没被点亮的空——这是全项目唯一能把「找不到」写成叙事的地方，所以它不用
// 大字号「404」+ 灰色 Oops。
//
// ⚠️ 不属于任何世界：hue 锁死 252。因为 hue 永不变化，SVG 渐变的 stop-color
// **直接写字面 oklch(…252…)**，绕开 §4 那条「var() 在声明处完成替换」的陷阱——
// 渐变的 stop 不在 .world-scope 的作用域里，写 var(--w-*) 会拿不到值。

// ⚠️ 三个航点必须是路径**自身的锚点**：(190,552) / (300,480) / (378,392) 正是
// 这条 C 链的段间锚点，所以永远贴在线上。目测放点、或改了路径忘了同步点位，
// 就会出现「亮点浮在线外」——那是这张图唯一会露馅的地方。
const TRAIL =
  "M -24 626 C 60 600, 130 580, 190 552 C 250 524, 272 505, 300 480 " +
  "C 330 455, 356 420, 378 392 C 400 364, 430 300, 452 268";
const WAYPOINTS: [number, number][] = [
  [190, 552],
  [300, 480],
  [378, 392],
];

export default function NotFound() {

  return (
    <div className={styles.root}>
      <Backdrop />
      {/* 顶栏保留，但不带 aria-current——404 不是一个导航目的地 */}
      <WxHeader />

      <main className={styles.shell}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>万象 · 无穷世界</p>
          <h1 className={styles.h1}>
            <span>这片坐标上，</span>
            <span>还没有星。</span>
          </h1>
          <p className={styles.lede}>
            你走过的那条路是真的，只是它到这里就断了。
            <br />
            也许这个世界还没被写出来——也许它本来就该由你来写。
          </p>

          <div className={styles.exits}>
            <Link className={styles.primary} href="/">
              回到星海
            </Link>
            <Link className={styles.ghost} href="/works">
              前往作品馆
            </Link>
            <Link className={styles.ghost} href="/community">
              前往社区
            </Link>
          </div>
        </div>

        <div className={styles.scenecol}>
          {/* 竖向构图：天在上、人在下。整块 aria-hidden，语义全部由 h1 与正文承担 */}
          <svg className={styles.scene} viewBox="0 0 700 660" aria-hidden="true">
            <defs>
              <linearGradient id="nf-trail" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stopColor="oklch(0.72 0.14 252)" stopOpacity="0.08" />
                <stop offset="55%" stopColor="oklch(0.78 0.13 252)" stopOpacity="0.7" />
                {/* 在抵达那颗星之前散掉：读作「你确实走过这些地方，但路到这里断了」 */}
                <stop offset="82%" stopColor="oklch(0.86 0.1 252)" stopOpacity="0.55" />
                <stop offset="100%" stopColor="oklch(0.86 0.1 252)" stopOpacity="0" />
              </linearGradient>
              <radialGradient id="nf-glow">
                <stop offset="0%" stopColor="oklch(0.34 0.036 252)" stopOpacity="0.74" />
                <stop offset="54%" stopColor="oklch(0.2 0.026 252)" stopOpacity="0.36" />
                <stop offset="100%" stopColor="oklch(0.2 0.026 252)" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* 地平线余光：存在的唯一理由是**让纯黑剪影读得出轮廓**。
                本页没有渐变天空，不给这层光，剪影会直接消失在深空底里。
                cy=584 / ry=70 让它正好在底边 y=660 之前衰减为 0，否则裁切处会留一条硬边。 */}
            <ellipse cx="396" cy="584" rx="240" ry="70" fill="url(#nf-glow)" />

            <path
              className={styles.trail}
              d={TRAIL}
              fill="none"
              stroke="url(#nf-trail)"
              strokeWidth="1.6"
              strokeLinecap="round"
            />

            {WAYPOINTS.map(([x, y], i) => (
              <circle
                key={`${x}-${y}`}
                className={styles.waypoint}
                cx={x}
                cy={y}
                r="3.4"
                fill="oklch(0.94 0.06 252)"
                style={{ animationDelay: `${0.42 + i * 0.3}s` }}
              />
            ))}

            {/* 熄灭的星：与星图的「待揭示节点」同一形态——空心虚线双环，不发光 */}
            <g className={styles.deadStar} transform="translate(486 150)">
              <circle
                r="40"
                fill="none"
                stroke="oklch(0.62 0.03 252)"
                strokeWidth="1.2"
                strokeDasharray="4 9"
                opacity="0.75"
              />
              <circle
                r="24"
                fill="none"
                stroke="oklch(0.58 0.028 252)"
                strokeWidth="1"
                strokeDasharray="3 7"
                opacity="0.6"
              />
            </g>

            {/* 剪影：gaze 姿态，站在地平线上仰头看那颗不亮的星。约占场景高度 10.6%——人小天大。
                它落在航迹右下方、星的正下方：放到 x≈300 时头顶离航迹只有 10 单位，会粘在一起。 */}
            <g transform="translate(396 529)" color="oklch(0.055 0.015 252)">
              <svg x="-38" y="-70" width="76" height="70" viewBox="0 0 100 92">
                <Figure pose="gaze" />
              </svg>
            </g>
          </svg>
        </div>
      </main>
    </div>
  );
}
