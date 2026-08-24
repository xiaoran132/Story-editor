// 确定性伪随机。**全站禁用 Math.random()**。
//
// 星点位置、微偏移、光晕相位、混沌排布都必须刷新一致：
// ① DESIGN.md §6 的纪律——「混沌排布用固定种子，保证每次刷新一致」，
//    位置每刷新一次就跳一次，那不是混沌，是抖动；
// ② 服务端渲染与客户端水合必须产出同一串数，Math.random() 会让 React
//    报 hydration mismatch；
// ③ 视觉回归靠并排截图，随机值让每次截图都不同，等于没有基线。
//
// 线性同余（LCG）。乘数 9301 / 增量 49297 / 模 233280 是原型里那一套，
// 周期远大于任何一屏的取点数（最大一屏 150 颗背景星）。

const A = 9301;
const C = 49297;
const M = 233280;

/** 建一个种子固定的取数器，连续调用产出 [0, 1) 上的伪随机序列。 */
export function makeRng(seed: number): () => number {
  // 负数与小数都先归一到 [0, M) 的整数，否则序列会退化成常数。
  let state = Math.floor(Math.abs(seed)) % M;
  return () => {
    state = (state * A + C) % M;
    return state / M;
  };
}

/** 把任意字符串（storyId、作品名）折成一个稳定的整数种子。 */
export function hashSeed(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) % M;
  }
  return h;
}

/** [min, max) 上的伪随机小数。 */
export function rngFloat(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** [min, max] 上的伪随机整数（闭区间）。 */
export function rngInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
