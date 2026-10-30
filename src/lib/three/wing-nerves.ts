/* 翅膀神经分形树：把"从翼根放射的直线主脉"改造成神经突触式结构。
 *
 * 主干（连接核心与节点的 NODE_VEIN 路径）在 flagship-butterfly 里单独建管，
 * 这里负责：沿主干与肋脉的生长锚点长出带种子的分形分支，并收集末端突触坐标。
 * 左右翼用不同种子 —— pivot 的 scale.x=-1 已经负责镜像，这里刻意让形态不对称，
 * 避免"左右完全对称"的死板感。
 *
 * 坐标约定：传入 / 返回的都是翼 pivot 的局部坐标（1 = 100 设计像素），
 * 与 flagship-butterfly 一致；生成只在 XY 平面内、z=0。
 */
import * as THREE from "three";

import type { WingQuadrant } from "./butterfly-scene";
import { mulberry32 } from "./deep-space";
import { parsePath, type Pt } from "./wing-geometry";

/** 12 设计像素一个锚点：比 parsePath 的 5px 稀，分支不至于挤成一团 */
const TRUNK_STEP = 0.12;
const AXIS_Z = new THREE.Vector3(0, 0, 1);

/** 半径阶梯（世界单位）：主干 0.021→0.007 见 flagship-butterfly，这里是一级分支 → 末端突触 */
const BRANCH_ROOT = 0.006;
const BRANCH_TIP = 0.0026;
const TWIG_ROOT = 0.0026;
const TWIG_TIP = 0.0011;

export type NerveTree = {
  branchPieces: THREE.BufferGeometry[];
  synapses: THREE.Vector3[];
};

export type NerveTreeOptions = {
  /** 分支长度倍率：肋脉上的分支比主干上的短 */
  lengthScale?: number;
  /** 每隔几个采样点取一个锚点 */
  stride?: number;
  /** 主干多长之后不再长分支（节点环附近留白） */
  anchorRatio?: number;
  /** 分支粗细倍率 */
  radiusScale?: number;
  /** 翼膜轮廓（翼局部坐标）：落在轮廓外的枝条直接丢弃，避免戳出翅膀 */
  bounds?: THREE.Vector2[];
};

/** 四翼固定种子：刷新稳定，且左右不同，避免镜像出形 */
const NERVE_SEEDS: Record<WingQuadrant, number> = {
  rightTop: 0x1a2b3c4d,
  leftTop: 0x5e6f7081,
  rightBottom: 0x9a0b1c2d,
  leftBottom: 0xd3e4f506,
};

export function nerveSeed(quadrant: WingQuadrant): number {
  return NERVE_SEEDS[quadrant];
}

function resampleByArc(points: THREE.Vector3[], step: number): THREE.Vector3[] {
  if (points.length < 2) return points.map((point) => point.clone());

  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) {
    cumulative.push(cumulative[i - 1] + points[i].distanceTo(points[i - 1]));
  }
  const total = cumulative[cumulative.length - 1];
  if (total < 1e-6) return [points[0].clone()];

  const out: THREE.Vector3[] = [];
  let segment = 1;
  for (let traveled = 0; traveled < total; traveled += step) {
    while (segment < cumulative.length - 1 && cumulative[segment] < traveled) segment += 1;
    const span = cumulative[segment] - cumulative[segment - 1];
    const t = span > 1e-9 ? (traveled - cumulative[segment - 1]) / span : 0;
    out.push(points[segment - 1].clone().lerp(points[segment], t));
  }
  const tip = points[points.length - 1];
  if (out[out.length - 1].distanceToSquared(tip) > 1e-8) out.push(tip.clone());
  return out;
}

/** 设计坐标路径 → 翼局部坐标折线，按弧长重采样（根→尖顺序不变）。 */
export function sampleTrunk(d: string, origin: Pt): THREE.Vector3[] {
  const polyline = parsePath(d)[0] ?? [];
  return resampleByArc(
    polyline.map(
      ([x, y]) => new THREE.Vector3((x - origin[0]) / 100, -(y - origin[1]) / 100, 0),
    ),
    TRUNK_STEP,
  );
}

/**
 * 变径管：TubeGeometry 半径恒定，一根等粗的长管会读成"荧光棒"。
 * 这里沿曲线参数插值半径（根粗梢细），并用同一条曲线的 Frenet 标架排环。
 * 输出与 TubeGeometry 相同的 position/normal/uv 三属性，可与普通管一起 merge。
 */
export function taperedTube(
  curve: THREE.Curve<THREE.Vector3>,
  tubular: number,
  radial: number,
  radiusAt: (t: number) => number,
): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(tubular, false);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= tubular; i += 1) {
    const t = i / tubular;
    const point = curve.getPointAt(t);
    const radius = Math.max(0.0006, radiusAt(t));
    const normal = frames.normals[i];
    const binormal = frames.binormals[i];

    for (let j = 0; j <= radial; j += 1) {
      const angle = (j / radial) * Math.PI * 2;
      const sin = Math.sin(angle);
      const cos = -Math.cos(angle);
      let nx = cos * normal.x + sin * binormal.x;
      let ny = cos * normal.y + sin * binormal.y;
      let nz = cos * normal.z + sin * binormal.z;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;
      positions.push(point.x + radius * nx, point.y + radius * ny, point.z + radius * nz);
      normals.push(nx, ny, nz);
      uvs.push(t, j / radial);
    }
  }

  for (let i = 1; i <= tubular; i += 1) {
    for (let j = 1; j <= radial; j += 1) {
      const a = (radial + 1) * (i - 1) + (j - 1);
      const b = (radial + 1) * i + (j - 1);
      const c = (radial + 1) * i + j;
      const d = (radial + 1) * (i - 1) + j;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

function bentSegment(
  from: THREE.Vector3,
  dir: THREE.Vector3,
  length: number,
  bend: number,
): THREE.QuadraticBezierCurve3 {
  const control = from.clone().addScaledVector(dir, length * 0.55);
  control.add(new THREE.Vector3(-dir.y, dir.x, 0).multiplyScalar(bend));
  return new THREE.QuadraticBezierCurve3(
    from.clone(),
    control,
    from.clone().addScaledVector(dir, length),
  );
}

/** 射线法点内判定（翼局部 XY 平面） */
function insidePolygon(x: number, y: number, polygon: THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * 沿主干锚点长出分形分支：默认每个采样点一个锚点（12 设计像素一个），方向在切线
 * 两侧交替偏 ±(18°~30°)，长度取剩余干长的 35%~60%（越靠翼尖越短），每条分支再生
 * 1~2 根更细的末端突触。主干最后 20% 不长分支 —— 那里是节点环的位置，留白给宝珠。
 * 管几何交调用方与肋脉一起 merge；突触只回传坐标，由调用方铺成 Points。
 */
export function buildNerveTree(
  trunk: THREE.Vector3[],
  seed: number,
  options: NerveTreeOptions = {},
): NerveTree {
  const { lengthScale = 1, stride = 1, anchorRatio = 0.8, radiusScale = 1, bounds } = options;
  const rand = mulberry32(seed);
  const branchPieces: THREE.BufferGeometry[] = [];
  const synapses: THREE.Vector3[] = [];
  if (trunk.length < 5) return { branchPieces, synapses };
  const bounded = Array.isArray(bounds) && bounds.length >= 3;

  let side = rand() > 0.5 ? 1 : -1;
  const lastAnchor = Math.max(3, Math.floor(trunk.length * anchorRatio));

  for (let i = 2; i < lastAnchor; i += stride) {
    const here = trunk[i];
    const tangent = trunk[i + 1].clone().sub(trunk[i - 1]).normalize();
    const spread = THREE.MathUtils.degToRad(18 + rand() * 12);
    const dir = tangent.clone().applyAxisAngle(AXIS_Z, side * spread);
    const remaining = (trunk.length - 1 - i) * TRUNK_STEP;
    const length = Math.min(0.85, remaining * (0.38 + rand() * 0.25)) * lengthScale;
    side *= -1;
    if (length < 0.06) continue;

    const end = here.clone().addScaledVector(dir, length);
    if (bounded && !insidePolygon(end.x, end.y, bounds!)) continue;

    const branch = bentSegment(here, dir, length, (rand() * 2 - 1) * length * 0.2);
    branchPieces.push(
      taperedTube(branch, 7, 3, (t) =>
        (BRANCH_ROOT + (BRANCH_TIP - BRANCH_ROOT) * t) * radiusScale,
      ),
    );

    const branchDir = end.clone().sub(branch.getPoint(0.55)).normalize();
    const twigCount = rand() > 0.15 ? 2 : 1;
    for (let k = 0; k < twigCount; k += 1) {
      const twigSpread = THREE.MathUtils.degToRad(22 + rand() * 20);
      const twigDir = branchDir.clone().applyAxisAngle(AXIS_Z, (k === 0 ? 1 : -1) * twigSpread);
      const twigLength = length * (0.42 + rand() * 0.2);
      const twigEnd = end.clone().addScaledVector(twigDir, twigLength);
      if (bounded && !insidePolygon(twigEnd.x, twigEnd.y, bounds!)) continue;
      const twig = bentSegment(end, twigDir, twigLength, (rand() * 2 - 1) * twigLength * 0.22);
      branchPieces.push(
        taperedTube(twig, 4, 3, (t) => (TWIG_ROOT + (TWIG_TIP - TWIG_ROOT) * t) * radiusScale),
      );
      synapses.push(twigEnd);
    }
  }

  return { branchPieces, synapses };
}
