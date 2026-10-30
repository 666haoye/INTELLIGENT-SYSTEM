/* E22「学习率敏感性扫描」的数学核心。
 *
 * 从组件里搬出来，是为了能在 node 里断言 —— 尤其「拖拽向量 → 学习率」这一步，
 * 它决定了这个 demo 教的是对的东西还是一个物理玩具。
 *
 * 关键式子：梯度下降一步就是 Δx = −lr·∇f(x)。所以给定用户甩出的位移 d，
 * 最小二乘意义下唯一对应的学习率是
 *     lr = −(d·∇f) / |∇f|²
 * 沿下坡甩 → 正 lr；甩反了 → 负 lr（球直接飞出去，真实的失败模式）；
 * 与坡度垂直 → lr≈0（那不是梯度步，球不动，也是对的）。
 */

export type Vec2 = [number, number];

/* 病态二次型：a/b = 7，碗又扁又长，条件数就是「可用学习率区间窄」的几何来源。 */
export const A = 0.35;
export const B = 0.05;

export const START: Vec2 = [2.6, 5];
/** 发散判据：跑出这个范围就截断，别让一条轨迹把场景撑爆。 */
export const ESCAPE = 9;
export const MAX_STEPS = 70;
/** lr 上限 = 2/a：超过它，沿陡轴的分量一步就跨到另一侧更远，越跑越大。 */
export const LR_STABILITY = 2 / A;

export const loss = ([x, z]: Vec2) => 0.5 * (A * x * x + B * z * z);
export const gradient = ([x, z]: Vec2): Vec2 => [A * x, B * z];

/** 拖拽位移（世界单位）→ 等效学习率。见文件头那个式子。 */
export function learningRateFromDrag(x0: Vec2, drag: Vec2): number {
  const g = gradient(x0);
  const gg = g[0] * g[0] + g[1] * g[1];
  if (gg < 1e-12) return 0;
  return -(drag[0] * g[0] + drag[1] * g[1]) / gg;
}

export type Outcome = "converged" | "oscillating" | "diverged";

export type Run = {
  lr: number;
  points: Vec2[];
  losses: number[];
  /** 走到第几步就收敛、发散或被截断 */
  stopStep: number;
  /** 轨迹是否跑出了截断范围（只描述轨迹，结局判定统一走 classify） */
  truncated: boolean;
};

/** 显式欧拉梯度下降。轨迹与静态页 exp-e22.js 的算法一致。 */
export function simulate(lr: number, x0: Vec2 = START, maxSteps = MAX_STEPS): Run {
  const points: Vec2[] = [];
  const losses: number[] = [];
  let [x, z] = x0;
  let stopStep = maxSteps;
  let truncated = false;

  for (let step = 0; step < maxSteps; step += 1) {
    const value = loss([x, z]);
    points.push([x, z]);
    losses.push(value);
    if (value < 0.01) {
      stopStep = step;
      break;
    }
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > ESCAPE || Math.abs(z) > ESCAPE) {
      truncated = true;
      stopStep = step;
      break;
    }
    x -= lr * A * x;
    z -= lr * B * z;
  }

  return { lr, points, losses, stopStep, truncated };
}

/**
 * 结局判定。
 *
 * 收敛/震荡的区分走真实轨迹（否则「震荡」这个观感是编出来的），但**发散用解析判据**：
 * 这个 f 是可分离的二次型，每根轴的单步因子就是 `1 − lr·a`，只要有一个轴的 |因子| > 1
 * 就必然发散。只靠轨迹数步数会漏判 —— lr 刚过 5.7143 时 |因子| 只比 1 大一点点，
 * 70 步内根本跑不出截断阈值，会被误报成「震荡收敛」。
 */
export function classify(lr: number): Outcome {
  const factorX = 1 - lr * A;
  const factorZ = 1 - lr * B;
  if (Math.abs(factorX) > 1 || Math.abs(factorZ) > 1) return "diverged";
  return factorX < 0 ? "oscillating" : "converged";
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  converged: "单调收敛",
  oscillating: "震荡收敛",
  diverged: "震荡发散",
};
