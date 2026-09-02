import type { CSSProperties } from "react";
import { makeRng } from "@/lib/prng";

// 固定背景栈：.space → .stars → .grain → .vignette，10/13 份原型共用。
// 整页只挂一次，放在页面根元素（.wx）内的最前面。
//
// 深空底色由 --ambient-hue 驱动（过渡 1.1s，回落 252）；暖金不跟着变。
// 环境染色的 hook 是 P1 的事，这里只负责把这四层画出来。
//
// ⚠️ 星点用确定性 PRNG 撒：原型里是 Math.random()，那会让服务端与客户端
// 撒出两张不同的星图，React 直接报水合失配。

export type BackdropProps = {
  /** 背景星数量。原型是 150 颗。 */
  starCount?: number;
  /** 同一个种子永远撒出同一张背景星图。 */
  seed?: number;
  /** 深空底色的色相；不传则跟随外层的 --ambient-hue。 */
  ambientHue?: number;
};

export default function Backdrop({ starCount = 150, seed = 9301, ambientHue }: BackdropProps) {
  const rng = makeRng(seed);
  const stars = Array.from({ length: starCount }, (_, i) => ({
    key: i,
    left: `${(rng() * 100).toFixed(2)}%`,
    top: `${(rng() * 100).toFixed(2)}%`,
    size: rng() < 0.86 ? 1 : 2,
    opacity: (0.16 + rng() * 0.62).toFixed(2),
  }));

  const spaceStyle = (
    ambientHue === undefined ? undefined : ({ "--ambient-hue": ambientHue } as CSSProperties)
  );

  return (
    <div aria-hidden="true">
      <div className="wx-space" style={spaceStyle} />
      <div className="wx-stars">
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
      <div className="wx-grain" />
      <div className="wx-vignette" />
    </div>
  );
}
