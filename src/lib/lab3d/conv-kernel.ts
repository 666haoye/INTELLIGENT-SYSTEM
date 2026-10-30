/**
 * E27「手工卷积核 → 可学习卷积核」的数学核心。
 *
 * 从 `public/experiments/exp-e27.js` 逐行移植，静态页里 `img`/`target`/`feat` 是 build
 * 闭包变量，这里提到模块级常量与显式入参：图像只有一张、Sobel 目标只算一次，
 * 两边共享才不会漂移。
 *
 * 一个不能省的细节：损失与梯度都除以 `interior = (N−2)²`（去掉一圈边界像素），
 * 不是 `N²`。写成 N² 的话梯度小一个量级看似更稳，但静态页验收的那条"400 步到 8e-4"
 * 是在 LR=0.5 + interior 归一化下标定出来的；漏掉这个归一化，LR=0.5 会直接发散。
 */

import { makeLabRng } from "./rng";

export const N = 64;
export const SEED = 10731;
export const LR = 0.5;
export const STEPS_PER_FRAME = 3;

/** 64×64 程序化灰度图（i 行 j 列），按行展开成一维。 */
function buildImage(): Float64Array {
  const img = new Float64Array(N * N);
  for (let i = 0; i < N; i += 1) {
    for (let j = 0; j < N; j += 1) {
      let v = 0.35;
      if (i > 10 && i < 30 && j > 10 && j < 30) v = 0.85; /* 亮方块 */
      if ((i - 44) * (i - 44) + (j - 20) * (j - 20) < 100) v = 0.12; /* 暗圆 */
      if (Math.abs(j - 0.7 * i - 6) < 0.9) v = 0.95; /* 亮斜线 */
      img[i * N + j] = v;
    }
  }
  return img;
}

export const IMAGE = buildImage();

export function clampIdx(x: number): number {
  return x < 0 ? 0 : x > N - 1 ? N - 1 : x;
}

/** 3×3 相关运算（不是真卷积：核不翻转），边界 clamp，out 写入 N×N。 */
export function conv(k: ArrayLike<number>, out: Float64Array): void {
  for (let i = 0; i < N; i += 1) {
    for (let j = 0; j < N; j += 1) {
      let s = 0;
      for (let m = 0; m < 3; m += 1) {
        const row = clampIdx(i + m - 1) * N;
        for (let n = 0; n < 3; n += 1) s += k[m * 3 + n] * IMAGE[row + clampIdx(j + n - 1)];
      }
      out[i * N + j] = s;
    }
  }
}

export type KernelName = "sobel" | "mean" | "sharp" | "emboss" | "id";

export const PRESETS: Record<KernelName, { label: string; k: number[] }> = {
  sobel: { label: "Sobel-x", k: [-1, 0, 1, -2, 0, 2, -1, 0, 1] },
  mean: {
    label: "均值",
    k: [1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9],
  },
  sharp: { label: "锐化", k: [0, -1, 0, -1, 5, -1, 0, -1, 0] },
  emboss: { label: "浮雕", k: [-2, -1, 0, -1, 1, 1, 0, 1, 2] },
  id: { label: "恒等", k: [0, 0, 0, 0, 1, 0, 0, 0, 0] },
};

export const SOBEL_K = PRESETS.sobel.k;

/** Sobel 目标图缓存一次，训练中不再重算。 */
export const SOBEL_TARGET = (() => {
  const out = new Float64Array(N * N);
  conv(SOBEL_K, out);
  return out;
})();

/** 损失只取内部像素（去掉 1 圈边界）。 */
export const INTERIOR = (N - 2) * (N - 2);

export function mseVs(k: ArrayLike<number>): number {
  const out = new Float64Array(N * N);
  conv(k, out);
  let s = 0;
  for (let i = 1; i < N - 1; i += 1) {
    for (let j = 1; j < N - 1; j += 1) {
      const e = out[i * N + j] - SOBEL_TARGET[i * N + j];
      s += e * e;
    }
  }
  return s / INTERIOR;
}

/** 随机初始化：9 个标准正态 × 0.3。种子固定，所以"随机"也是可复现的。 */
export function randomKernel(): number[] {
  const r = makeLabRng(SEED);
  const out: number[] = [];
  for (let w = 0; w < 9; w += 1) out.push(r.gauss() * 0.3);
  return out;
}

/** 训练一步：∂L/∂k[m][n] = 2·Σ((pred−d)·img[j+m][i+n]) / interior。k 就地更新。 */
export function trainStep(k: number[], feat: Float64Array): void {
  conv(k, feat);
  const g = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 1; i < N - 1; i += 1) {
    for (let j = 1; j < N - 1; j += 1) {
      const e = (2 * (feat[i * N + j] - SOBEL_TARGET[i * N + j])) / INTERIOR;
      for (let m = 0; m < 3; m += 1) {
        const row = clampIdx(i + m - 1) * N;
        for (let n = 0; n < 3; n += 1) g[m * 3 + n] += e * IMAGE[row + clampIdx(j + n - 1)];
      }
    }
  }
  for (let w = 0; w < 9; w += 1) k[w] -= LR * g[w];
}

export function cosineSim(k: ArrayLike<number>, ref: ArrayLike<number> = SOBEL_K): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let w = 0; w < 9; w += 1) {
    dot += k[w] * ref[w];
    na += k[w] * k[w];
    nb += ref[w] * ref[w];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}

export type TrainedKernel = { k: number[]; mse: number; cosine: number; steps: number };

/** 从随机初始化跑 steps 步训练，断言与场景共用同一条路径。 */
export function trainKernel(steps: number, start?: number[]): TrainedKernel {
  const k = start ? start.slice() : randomKernel();
  const feat = new Float64Array(N * N);
  for (let s = 0; s < steps; s += 1) trainStep(k, feat);
  return { k, mse: mseVs(k), cosine: cosineSim(k), steps };
}
