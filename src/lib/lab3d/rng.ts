/**
 * 定种子伪随机数。三个 3D 实验都要「同种子 → 同场景」，各写一份迟早对不上，
 * 所以在这里放唯一一份。mulberry32 小而均匀，换机器跑出来的序列逐位一致。
 */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller：把两个均匀分布变成两个标准正态。点云和高斯噪声都要用。 */
export function gaussian(rand: () => number): number {
  let u = rand();
  if (u < 1e-12) u = 1e-12;
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * 静态实验页 `public/experiments/lab.js` 里那颗 RNG 的逐行复刻（lab.js 的 `rng(seed)`）。
 *
 * 为什么不能直接复用上面的 gaussian：这里是 Marsaglia 极坐标 + 一个 spare 缓存，
 * 每次 gauss() 消费 2 个均匀数、吐出 1 个并**存下另一个**供下次直接返回。
 * E04 的数据是 `next()` 出 x 抖动、`gauss()` 出噪声，两者共用同一条均匀流；
 * Box-Muller 的消耗节奏不一样，序列就错开，验收数字（0.158 / 0.524 / 0.115 → 0.019）对不上。
 */
export function makeLabRng(seed: number): { next(): number; gauss(): number } {
  let a = seed >>> 0;
  let spare: number | null = null;

  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const gauss = () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    let v = 0;
    let sq = 0;
    do {
      u = next() * 2 - 1;
      v = next() * 2 - 1;
      sq = u * u + v * v;
    } while (sq === 0 || sq >= 1);
    const mul = Math.sqrt((-2 * Math.log(sq)) / sq);
    spare = v * mul;
    return u * mul;
  };

  return { next, gauss };
}
