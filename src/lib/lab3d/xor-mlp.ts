/* E12「两层 MLP 解决 XOR」的数学核心。
 *
 * 刻意**不 import three、不 import R3F**：这个模块要能在 node 里直接跑断言。
 * 「拖拽拉起空间」之所以不是套皮动画，就是因为 lift 这个数在这里有明确含义 ——
 * 把隐藏层的非线性表示一点点混进线性模型里。渲染层只负责把这里的数字画出来。
 *
 * 设定与 `public/experiments/exp-e12.js` 对齐（同一份数据、同一结构、同一算法），
 * 这样 2D 页和 3D 页讲的是同一个实验：
 *   数据 4 点 ×10 份、隐藏 2 层 × 每层 4 单元、relu、sigmoid 输出、交叉熵、全批量梯度下降。
 */

import { mulberry32 } from "./rng";

/** 与静态页 BASE 逐字相同的 XOR 真值表：[x1, x2, label] */
export const XOR_BASE: readonly (readonly [number, number, number])[] = [
  [-1, -1, 0],
  [-1, 1, 1],
  [1, -1, 1],
  [1, 1, 0],
];

/** 静态页把 4 个点复制 10 份凑成 40 样本，这里照搬，保证两条曲线的 loss 量级可比。 */
const REPLICATES = 10;

/* 文案（标题/章节/页码/purpose/form/conclusion/acceptance）统一在 experiment-copy.ts，
   别在这里再抄一份 —— 三个 3D 实验各抄一遍就一定会漂。 */

export type Layer = {
  /** w[out][in] */
  w: number[][];
  b: number[];
};

export type XorModel = {
  layers: Layer[];
  loss: number;
  accuracy: number;
  steps: number;
};

export type TrainOptions = {
  steps?: number;
  lr?: number;
  seed?: number;
  hiddenUnits?: number;
};

const DEFAULTS: Required<TrainOptions> = {
  steps: 1500,
  lr: 0.6,
  seed: 12007,
  hiddenUnits: 4,
};

/* mulberry32：小而可复现，换机器跑出来的权重逐位一致，断言才有意义。 */
/* mulberry32 见 ./rng.ts —— 三个场景共用一个定种子实现，不再各写一份。 */

const relu = (z: number) => (z > 0 ? z : 0);
const reluDeriv = (z: number) => (z > 0 ? 1 : 0);
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** 交叉熵里夹住概率：p 取到 0 或 1 会让 log 变成 ±Infinity，一个 NaN 就能毁掉整次训练。 */
const clampProb = (p: number) => Math.min(1 - 1e-12, Math.max(1e-12, p));

type Cache = {
  /** 每层的激活值（含输入层） */
  activations: number[][][];
  /** 每层 relu 的 pre-activation，反向时要求导 */
  pre: number[][][];
};

function forward(model: XorModel, inputs: number[][]): Cache {
  const activations: number[][][] = [inputs];
  const pre: number[][][] = [[]];
  let current = inputs;

  model.layers.forEach((layer, li) => {
    const isLast = li === model.layers.length - 1;
    const nextPre = current.map((row) =>
      layer.w.map((weights, o) => {
        let z = layer.b[o];
        for (let i = 0; i < weights.length; i += 1) z += weights[i] * (row[i] ?? 0);
        return z;
      }),
    );
    const next = nextPre.map((row) =>
      row.map((z) => (isLast ? sigmoid(z) : relu(z))),
    );
    pre.push(nextPre);
    activations.push(next);
    current = next;
  });

  return { activations, pre };
}

/** 输出层取第 0 列（单输出）。 */
function probabilityAt(model: XorModel, x: number[]): number {
  const cache = forward(model, [x]);
  const last = cache.activations[cache.activations.length - 1];
  return last[0][0];
}

/** 折叠的关键：输出层 sigmoid **之前**那个 logit。lift 是在两个 logit 之间插值。 */
function logitOf(model: XorModel, x: number[]): number {
  const cache = forward(model, [x]);
  const pre = cache.pre[cache.pre.length - 1];
  return pre[0][0];
}

function dataset(): { xs: number[][]; ys: number[] } {
  const xs: number[][] = [];
  const ys: number[] = [];
  for (let r = 0; r < REPLICATES; r += 1) {
    for (const [x1, x2, y] of XOR_BASE) {
      xs.push([x1, x2]);
      ys.push(y);
    }
  }
  return { xs, ys };
}

function initLayers(sizes: number[], rand: () => number): Layer[] {
  const layers: Layer[] = [];
  for (let l = 1; l < sizes.length; l += 1) {
    const fanIn = sizes[l - 1];
    /* relu 层用 He 尺度，sigmoid 输出层用 Xavier 尺度；两者都够小，不会一上来就把对方压死。 */
    const last = l === sizes.length - 1;
    const scale = Math.sqrt((last ? 2 : 2.4) / fanIn);
    layers.push({
      w: Array.from({ length: sizes[l] }, () =>
        Array.from({ length: fanIn }, () => (rand() * 2 - 1) * scale),
      ),
      b: Array.from({ length: sizes[l] }, () => (rand() * 2 - 1) * 0.05),
    });
  }
  return layers;
}

/** 反向传播主体。手写的，不走 autograd：40 样本 × 3 层，看清每一步比省代码更值。 */
function descend(model: XorModel, opts: Required<TrainOptions>, data: DataSet): void {
  const { xs, ys, n } = data;

  for (let step = 0; step < opts.steps; step += 1) {
    const cache = forward(model, xs);
    const L = model.layers.length;

    /* 输出层 δ = p − y（sigmoid + 交叉熵的标准结果） */
    const deltas: number[][][] = new Array(L);
    for (let i = 0; i < n; i += 1) {
      const out = cache.activations[L][i];
      deltas[L - 1] ??= Array.from({ length: n }, () => new Array(out.length).fill(0));
      for (let j = 0; j < out.length; j += 1) {
        deltas[L - 1][i][j] = clampProb(out[j]) - ys[i];
      }
    }

    for (let l = L - 2; l >= 0; l -= 1) {
      deltas[l] = Array.from({ length: n }, () => new Array(model.layers[l].w[0].length).fill(0));
      for (let i = 0; i < n; i += 1) {
        const nextDelta = deltas[l + 1][i];
        const preRow = cache.pre[l + 1][i];
        for (let h = 0; h < deltas[l][i].length; h += 1) {
          let acc = 0;
          for (let j = 0; j < nextDelta.length; j += 1) {
            acc += nextDelta[j] * model.layers[l + 1].w[j][h];
          }
          deltas[l][i][h] = acc * reluDeriv(preRow[h]);
        }
      }
    }

    for (let l = 0; l < L; l += 1) {
      const layer = model.layers[l];
      const prevActivations = cache.activations[l];
      for (let j = 0; j < layer.w.length; j += 1) {
        for (let i = 0; i < layer.w[j].length; i += 1) {
          let g = 0;
          for (let s = 0; s < n; s += 1) g += deltas[l][s][j] * prevActivations[s][i];
          layer.w[j][i] -= (opts.lr * g) / n;
        }
        let gb = 0;
        for (let s = 0; s < n; s += 1) gb += deltas[l][s][j];
        layer.b[j] -= (opts.lr * gb) / n;
      }
    }
  }
}

function fit(sizes: number[], opts: Required<TrainOptions>, data: DataSet): XorModel {
  const rand = mulberry32(opts.seed);
  const model: XorModel = {
    layers: initLayers(sizes, rand),
    loss: NaN,
    accuracy: NaN,
    steps: opts.steps,
  };
  descend(model, opts, data);
  model.loss = datasetLoss(model, data);
  model.accuracy = datasetAccuracy(model, data);
  return model;
}

function xorDataSet(): DataSet {
  const { xs, ys } = dataset();
  return { xs, ys, n: xs.length };
}

/** 在 XOR 全集上训练。 */
function train(sizes: number[], opts: Required<TrainOptions>): XorModel {
  return fit(sizes, opts, xorDataSet());
}

let mlpCache: XorModel | null = null;
let probeCache: { model: XorModel; gain: number; droppedIndex: number } | null = null;

/** 2 层 × 4 单元的 MLP。同种子必然同权重，所以地形是完全可复现的。 */
export function trainXorMlp(options: TrainOptions = {}): XorModel {
  const opts = { ...DEFAULTS, ...options };
  if (mlpCache && opts.steps === DEFAULTS.steps && opts.seed === DEFAULTS.seed) return mlpCache;
  const model = train([2, opts.hiddenUnits, opts.hiddenUnits, 1], opts);
  if (opts.steps === DEFAULTS.steps && opts.seed === DEFAULTS.seed) mlpCache = model;
  return model;
}

/**
 * lift = 0 那一端：没有隐藏层的同一算法**能达到的最好直线**。
 *
 * 这里有个坑值得写下来：直接拿原始 XOR 标签训线性模型，梯度下降收敛到
 * loss = ln2 = 0.6931、w ≈ 0、准确率 50% 的那个退化解 —— 因为 XOR 在任一直线方向上
 * 两侧都各有一个正例和一个反例，ln2 就是线性模型的全局最优。于是「线性端」会是一张
 * 完全平在 0.5 上的白纸，拖拽时曲面什么也不会发生，demo 直接废掉。
 * 所以取「最好的一条直线」= 允许判错一个点、剩下三个分开：这才是 e11 那句
 * 「准确率封顶 75%」的几何本体，也让 lift 从 0 拉起来时能看到直线真的在弯成两块。
 *
 * 做法不玄学：对 4 个点逐个把标签翻掉再训线性模型（翻完必线性可分、loss 能压到 0），
 * 取在**原始标签**上准确率最高的那个。全程同一算法、同一种子，可复现。
 *
 * 另外要除以一个增益：线性可分时权重要多大就多大，实测 1500 步后 |logit| 飙到 22.7，
 * σ 彻底饱和成一刀切的台阶，而且它会压过 MLP 那一端、让折叠过程几乎看不见。
 * 按数据点上的最大 |logit| 归一到线性尺度不改变任何一侧的正负号（准确率、边界形状都不变），
 * 只是把台阶变成能被看见的缓坡。
 */
const LINEAR_TARGET_LOGIT = 4.5;

function trainLinearProbe(): { model: XorModel; gain: number; droppedIndex: number } {
  if (probeCache) return probeCache;

  let best: { model: XorModel; droppedIndex: number } | null = null;
  const original = XOR_BASE;

  for (let drop = 0; drop < original.length; drop += 1) {
    const flipped: (readonly [number, number, number])[] = original.map((row, i) =>
      i === drop ? [row[0], row[1], 1 - row[2]] : row,
    );
    const model = trainOn(flipped, [2, 1], DEFAULTS);
    if (!best || model.accuracy > best.model.accuracy) best = { model, droppedIndex: drop };
  }

  const chosen = best ?? { model: train([2, 1], DEFAULTS), droppedIndex: -1 };
  const peak = Math.max(
    ...original.map(([x1, x2]) => Math.abs(logitOf(chosen.model, [x1, x2]))),
    1e-6,
  );

  probeCache = {
    model: chosen.model,
    gain: LINEAR_TARGET_LOGIT / peak,
    droppedIndex: chosen.droppedIndex,
  };
  return probeCache;
}

/** 与 train() 同一套前向/反向，只是换一份标签。 */
function trainOn(
  rows: readonly (readonly [number, number, number])[],
  sizes: number[],
  opts: Required<TrainOptions>,
): XorModel {
  const xs = rows.map(([x1, x2]) => [x1, x2]);
  const ys = rows.map(([, , y]) => y);
  return fit(sizes, opts, { xs, ys, n: xs.length });
}

/* ── 上面 train() 的通用化：把「数据」从全局 XOR 里拆出来，好让探针用别的标签 ── */

type DataSet = { xs: number[][]; ys: number[]; n: number };

function datasetLoss(model: XorModel, data: DataSet): number {
  let sum = 0;
  for (let i = 0; i < data.n; i += 1) {
    const p = clampProb(probabilityAt(model, data.xs[i]));
    sum -= data.ys[i] * Math.log(p) + (1 - data.ys[i]) * Math.log(1 - p);
  }
  return sum / data.n;
}

function datasetAccuracy(model: XorModel, data: DataSet): number {
  let hits = 0;
  for (let i = 0; i < data.n; i += 1) {
    if ((probabilityAt(model, data.xs[i]) >= 0.5 ? 1 : 0) === data.ys[i]) hits += 1;
  }
  return hits / data.n;
}

/**
 * 「向上拉起空间」的数学定义：
 *   logit(x, lift) = (1 − lift) · 最好直线的logit + lift · MLP 的logit
 * lift = 0 是一条直线切不开 XOR（封顶 75%），lift = 1 是两座山（100%）。
 * 两端都用同一套 sigmoid 输出，所以中间是连续形变 —— 拖拽时看到的不是动画，是这个式子本身。
 */
export function logitAt(x: number[], lift: number, mlp = trainXorMlp(), probe = trainLinearProbe()) {
  const zLinear = logitOf(probe.model, x) * probe.gain;
  const zMlp = logitOf(mlp, x);
  return (1 - lift) * zLinear + lift * zMlp;
}

/** 曲面高度就用这个概率本身：于是 y = 0.5 那块玻璃面与地形的交线，天然就是决策边界。 */
export function heightAt(x: number[], lift: number, mlp?: XorModel): number {
  return sigmoid(logitAt(x, lift, mlp));
}

export function outputAt(x: number[], lift: number): number {
  return heightAt(x, lift);
}

export function accuracyAt(lift: number): number {
  const mlp = trainXorMlp();
  let hits = 0;
  for (const [x1, x2, y] of XOR_BASE) {
    const predicted = heightAt([x1, x2], lift, mlp) >= 0.5 ? 1 : 0;
    if (predicted === y) hits += 1;
  }
  return hits / XOR_BASE.length;
}

export const DOMAIN = 1.6;

/** 输入平面上的网格点（左上到右下，逐行）。渲染层按同一顺序填顶点。 */
export function gridPositions(res: number): number[] {
  const out: number[] = [];
  for (let iz = 0; iz <= res; iz += 1) {
    for (let ix = 0; ix <= res; ix += 1) {
      out.push((ix / res - 0.5) * 2 * DOMAIN, (iz / res - 0.5) * 2 * DOMAIN);
    }
  }
  return out;
}

/** 给定 lift 的全部网格高度。两端点各算一次再 lerp 是渲染层的事，这里只给真值。 */
export function gridHeights(lift: number, res: number): Float32Array {
  const mlp = trainXorMlp();
  const flat = gridPositions(res);
  const out = new Float32Array(flat.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = heightAt([flat[i * 2], flat[i * 2 + 1]], lift, mlp);
  }
  return out;
}

/** 4 个数据点及其标签，渲染层直接摆球。 */
export const DATA_POINTS = XOR_BASE.map(([x1, x2, y]) => ({ x: x1, z: x2, label: y }));
