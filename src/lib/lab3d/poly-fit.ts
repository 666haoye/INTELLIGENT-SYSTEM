/**
 * E04「多项式阶数看过拟合与欠拟合」的数学核心。
 *
 * 从 `public/experiments/exp-e04.js` 逐行移植，只改了闭包：静态页把 `w`/`noise` 存在
 * build 作用域里，这里一律改成显式入参，于是同一份代码既能被 node 断言直接调用，
 * 也能被 3D 场景调用，两边算出来的数字逐位一致。
 *
 * 两处不能"顺手优化"的地方，都是验收数字的前提：
 * 1. 求和必须走 Neumaier 补偿（静态页原话：高次幂累加的舍入误差会破坏训练误差的单调性）；
 * 2. evalPoly 必须是 `p *= x` 的幂累乘写法，换成秦九韶（Horner）末位舍入不同，
 *    deg=12 那 0.019 就对不上验收。
 */

import { makeLabRng } from "./rng";

export type Point = [number, number];

export const TRAIN_SEED = 5599;
export const TEST_SEED = 5600;
export const TEST_N = 40;
export const DEFAULT_TRAIN_N = 16;
export const DEFAULT_NOISE = 0.15;
/** 静态页的滑条是 1..14；误差墙只画到 12，够把 U 形的右半边画完整。 */
export const DEGREE_MIN = 1;
export const DEGREE_MAX = 12;

/** 训练 n 点：x_i = −1 + 2(i+0.5)/n + 抖动(±0.015)，y_i = sin(πx_i) + noise × 标准正态。 */
export function genData(seed: number, count: number, noise = DEFAULT_NOISE): Point[] {
  const r = makeLabRng(seed);
  const pts: Point[] = [];
  for (let i = 0; i < count; i += 1) {
    const x = -1 + (2 * (i + 0.5)) / count + (r.next() * 2 - 1) * 0.015;
    pts.push([x, Math.sin(Math.PI * x) + noise * r.gauss()]);
  }
  return pts;
}

/* ================= 正规方程求解 ================= */

/** Neumaier 补偿求和的累加器。 */
type Acc = { s: number; c: number };

function accNew(): Acc {
  return { s: 0, c: 0 };
}

function accAdd(a: Acc, x: number): void {
  const t = a.s + x;
  if (Math.abs(a.s) >= Math.abs(x)) a.c += a.s - t + x;
  else a.c += x - t + a.s;
  a.s = t;
}

function accVal(a: Acc): number {
  return a.s + a.c;
}

/** 高斯消元（部分选主元），A 就地破坏。 */
export function solveLinear(A: number[][], b: number[]): number[] {
  const len = b.length;
  const m = A.map((row) => row.slice());
  const rhs = b.slice();
  for (let i = 0; i < len; i += 1) {
    let piv = i;
    let best = Math.abs(m[i][i]);
    for (let k = i + 1; k < len; k += 1) {
      const v = Math.abs(m[k][i]);
      if (v > best) {
        best = v;
        piv = k;
      }
    }
    if (piv !== i) {
      const tmp = m[i];
      m[i] = m[piv];
      m[piv] = tmp;
      const tb = rhs[i];
      rhs[i] = rhs[piv];
      rhs[piv] = tb;
    }
    const d = m[i][i] || 1e-300;
    for (let k = i + 1; k < len; k += 1) {
      const f = m[k][i] / d;
      if (f === 0) continue;
      for (let j = i; j < len; j += 1) m[k][j] -= f * m[i][j];
      rhs[k] -= f * rhs[i];
    }
  }
  const out = new Array<number>(len);
  for (let i = len - 1; i >= 0; i -= 1) {
    let s = rhs[i];
    for (let j = i + 1; j < len; j += 1) s -= m[i][j] * out[j];
    out[i] = s / (m[i][i] || 1e-300);
  }
  return out;
}

/** 设计矩阵 deg+1 列，row[j] = x^j；解 (XᵀX + 1e-9·I) w = Xᵀy。 */
export function fitPoly(pts: Point[], order: number): number[] {
  const D = order + 1;
  const g: Acc[][] = [];
  const rhs: Acc[] = [];
  for (let j = 0; j < D; j += 1) {
    const rowAcc: Acc[] = [];
    for (let k = 0; k < D; k += 1) rowAcc.push(accNew());
    g.push(rowAcc);
    rhs.push(accNew());
  }
  for (let i = 0; i < pts.length; i += 1) {
    const x = pts[i][0];
    const row = [1];
    for (let j = 1; j < D; j += 1) row.push(row[j - 1] * x);
    for (let j = 0; j < D; j += 1) {
      for (let k = 0; k <= j; k += 1) accAdd(g[j][k], row[j] * row[k]);
      accAdd(rhs[j], row[j] * pts[i][1]);
    }
  }
  const A: number[][] = [];
  const b: number[] = [];
  for (let j = 0; j < D; j += 1) {
    const ar: number[] = [];
    for (let k = 0; k < D; k += 1) ar.push(k <= j ? accVal(g[j][k]) : 0);
    A.push(ar);
    b.push(accVal(rhs[j]));
  }
  for (let j = 0; j < D; j += 1) {
    for (let k = 0; k < j; k += 1) A[k][j] = A[j][k];
    A[j][j] += 1e-9;
  }
  return solveLinear(A, b);
}

export function evalPoly(weights: number[], x: number): number {
  let s = 0;
  let p = 1;
  for (let j = 0; j < weights.length; j += 1) {
    s += weights[j] * p;
    p *= x;
  }
  return s;
}

export function rmseOf(weights: number[], pts: Point[]): number {
  const acc = accNew();
  for (let i = 0; i < pts.length; i += 1) {
    const d = evalPoly(weights, pts[i][0]) - pts[i][1];
    accAdd(acc, d * d);
  }
  return Math.sqrt(accVal(acc) / pts.length);
}

/* ================= 供场景与断言共用的封装 ================= */

export type Dataset = { train: Point[]; test: Point[] };

/**
 * 数据集只由 (noise, trainN) 决定，一次算好反复用：
 * 场景里每帧要对 floor/ceil 两个阶数各拟合一次，误差墙上还要扫 12 个阶数。
 */
export function makeDataset(noise = DEFAULT_NOISE, trainN = DEFAULT_TRAIN_N): Dataset {
  return {
    train: genData(TRAIN_SEED, trainN, noise),
    test: genData(TEST_SEED, TEST_N, noise),
  };
}

let defaultDataset: Dataset | null = null;
function defaults(): Dataset {
  if (defaultDataset === null) defaultDataset = makeDataset();
  return defaultDataset;
}

export type FitResult = {
  degree: number;
  weights: number[];
  trainRmse: number;
  testRmse: number;
  gap: number;
  params: number;
};

export function fitAt(degree: number, data: Dataset = defaults()): FitResult {
  const weights = fitPoly(data.train, degree);
  const trainRmse = rmseOf(weights, data.train);
  const testRmse = rmseOf(weights, data.test);
  return {
    degree,
    weights,
    trainRmse,
    testRmse,
    gap: testRmse - trainRmse,
    params: degree + 1,
  };
}

/** 误差墙：deg 从 DEGREE_MIN 到 DEGREE_MAX 的训练/测试 RMSE 序列。 */
export function errorSweep(data: Dataset = defaults(), maxDegree = DEGREE_MAX): FitResult[] {
  const out: FitResult[] = [];
  for (let d = DEGREE_MIN; d <= maxDegree; d += 1) out.push(fitAt(d, data));
  return out;
}
