/* E08「PCA 降维与重建」的数学核心。
 *
 * 与 xor-mlp.ts 同一个原则：不 import three、不 import R3F，全部可在 node 里断言。
 * 场景里那声「捏橡皮泥」之所以不是动画皮，是因为挤压改变的是**协方差矩阵本身**，
 * 特征向量随之旋转 —— 主成分方向是被算出来的，不是被摆出来的。
 */

import { gaussian, mulberry32 } from "./rng";

export type Vec3 = [number, number, number];
/** 3×3，按行 */
export type Mat3 = [Vec3, Vec3, Vec3];

/** 各轴标准差拉开，第一主成分才明显；再整体转一个固定角度，避免主方向正好贴着坐标轴。 */
const AXIS_SD: Vec3 = [1, 0.55, 0.26];
const FIXED_EULER: Vec3 = [0.42, 0.95, 0.23];

function rotationFromEuler([rx, ry, rz]: Vec3): Mat3 {
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  return [
    [cy * cz, cy * sz, -sy],
    [sx * sy * cz - cx * sz, sx * sy * sz + cx * cz, sx * cy],
    [cx * sy * cz + sx * sz, cx * sy * sz - sx * cz, cx * cy],
  ];
}

const apply = (m: Mat3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

/** 定种子的各向异性高斯点云，平铺成 xyz 三元组。 */
export function makeCloud(count: number, seed = 8208): Float32Array {
  const rand = mulberry32(seed);
  const rotation = rotationFromEuler(FIXED_EULER);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const local: Vec3 = [
      gaussian(rand) * AXIS_SD[0],
      gaussian(rand) * AXIS_SD[1],
      gaussian(rand) * AXIS_SD[2],
    ];
    const p = apply(rotation, local);
    out[i * 3] = p[0];
    out[i * 3 + 1] = p[1];
    out[i * 3 + 2] = p[2];
  }
  return out;
}

export function centroid(points: Float32Array): Vec3 {
  const n = points.length / 3;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < n; i += 1) {
    x += points[i * 3];
    y += points[i * 3 + 1];
    z += points[i * 3 + 2];
  }
  return [x / n, y / n, z / n];
}

/**
 * 沿单位轴把点云压扁：`p' = p − amount·(p·axis)·axis`。
 * amount = 0 原样，amount = 1 完全拍到垂直于该轴的平面上。
 */
export function squeezeInto(
  src: Float32Array,
  dst: Float32Array,
  axis: Vec3,
  amount: number,
): void {
  const [ax, ay, az] = axis;
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i];
    const y = src[i + 1];
    const z = src[i + 2];
    const along = (x * ax + y * ay + z * az) * amount;
    dst[i] = x - along * ax;
    dst[i + 1] = y - along * ay;
    dst[i + 2] = z - along * az;
  }
}

export function squeeze(points: Float32Array, axis: Vec3, amount: number): Float32Array {
  const out = new Float32Array(points.length);
  squeezeInto(points, out, axis, amount);
  return out;
}

/** 协方差矩阵（已去均值）。 */
export function covariance3(points: Float32Array): Mat3 {
  const n = points.length / 3;
  const [mx, my, mz] = centroid(points);
  /* 六个独立累加器：对称矩阵只需要上三角 + 对角，写两遍等于白算一倍。 */
  let sxx = 0;
  let syy = 0;
  let szz = 0;
  let sxy = 0;
  let sxz = 0;
  let syz = 0;

  for (let i = 0; i < n; i += 1) {
    const dx = points[i * 3] - mx;
    const dy = points[i * 3 + 1] - my;
    const dz = points[i * 3 + 2] - mz;
    sxx += dx * dx;
    syy += dy * dy;
    szz += dz * dz;
    sxy += dx * dy;
    sxz += dx * dz;
    syz += dy * dz;
  }

  return [
    [sxx / n, sxy / n, sxz / n],
    [sxy / n, syy / n, syz / n],
    [sxz / n, syz / n, szz / n],
  ];
}

export type Eigen = {
  /** 降序 */
  values: Vec3;
  /** vectors[i] 是第 i 个特征值对应的单位特征向量 */
  vectors: [Vec3, Vec3, Vec3];
};

/**
 * 3×3 对称矩阵的循环 Jacobi 特征分解。不引线性代数库：
 * 3×3 对称矩阵旋转几十次就到机器精度，µs 级，4000 点每帧重算也毫无压力。
 */
export function jacobiEigen3(input: Mat3): Eigen {
  let a: Mat3 = [
    [input[0][0], input[0][1], input[0][2]],
    [input[1][0], input[1][1], input[1][2]],
    [input[2][0], input[2][1], input[2][2]],
  ];
  let v: Mat3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  const pairs: [number, number][] = [
    [0, 1],
    [0, 2],
    [1, 2],
  ];

  for (let sweep = 0; sweep < 24; sweep += 1) {
    const off =
      a[0][1] * a[0][1] + a[0][2] * a[0][2] + a[1][2] * a[1][2];
    if (off < 1e-22) break;

    for (const [p, q] of pairs) {
      const apq = a[p][q];
      if (Math.abs(apq) < 1e-18) continue;

      const theta = (a[q][q] - a[p][p]) / (2 * apq);
      const t =
        Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;

      const app = a[p][p];
      const aqq = a[q][q];
      a[p][p] = app - t * apq;
      a[q][q] = aqq + t * apq;
      a[p][q] = 0;
      a[q][p] = 0;

      for (let k = 0; k < 3; k += 1) {
        if (k === p || k === q) continue;
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[p][k] = a[k][p];
        a[k][q] = s * akp + c * akq;
        a[q][k] = a[k][q];
      }

      for (let k = 0; k < 3; k += 1) {
        const vkp = v[k][p];
        const vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }

  const raw: { value: number; vector: Vec3 }[] = [0, 1, 2].map((i) => ({
    value: a[i][i],
    vector: [v[0][i], v[1][i], v[2][i]],
  }));
  raw.sort((lhs, rhs) => rhs.value - lhs.value);

  return {
    values: [raw[0].value, raw[1].value, raw[2].value],
    vectors: [raw[0].vector, raw[1].vector, raw[2].vector],
  };
}

export type PrincipalFrame = {
  center: Vec3;
  pc1: Vec3;
  pc2: Vec3;
  pc3: Vec3;
  values: Vec3;
  /** 各主成分解释的方差占比，和为 1 */
  explained: Vec3;
};

/** 给定（已挤压的）点云，算出主成分标架。玻璃板就是过 center、由 pc1/pc2 张成的平面。 */
export function principalFrame(points: Float32Array): PrincipalFrame {
  const { values, vectors } = jacobiEigen3(covariance3(points));
  const total = values[0] + values[1] + values[2];
  const explained: Vec3 =
    total > 1e-12
      ? [values[0] / total, values[1] / total, values[2] / total]
      : [1 / 3, 1 / 3, 1 / 3];
  return {
    center: centroid(points),
    pc1: vectors[0],
    pc2: vectors[1],
    pc3: vectors[2],
    values,
    explained,
  };
}

/** 点 p 在平面（center + span(pc1, pc2)）上的投影点与残差长度。红线就是这条残差。 */
export function projection(
  p: Vec3,
  center: Vec3,
  pc1: Vec3,
  pc2: Vec3,
): { point: Vec3; residual: number } {
  const d: Vec3 = [p[0] - center[0], p[1] - center[1], p[2] - center[2]];
  const s1 = d[0] * pc1[0] + d[1] * pc1[1] + d[2] * pc1[2];
  const s2 = d[0] * pc2[0] + d[1] * pc2[1] + d[2] * pc2[2];
  const point: Vec3 = [
    center[0] + s1 * pc1[0] + s2 * pc2[0],
    center[1] + s1 * pc1[1] + s2 * pc2[1],
    center[2] + s1 * pc1[2] + s2 * pc2[2],
  ];
  const residual = Math.hypot(p[0] - point[0], p[1] - point[1], p[2] - point[2]);
  return { point, residual };
}

export function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}
