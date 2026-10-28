/* 光路：不另造一条"核心→节点"的曲线，而是复用翅膀上**已有的那条神经**。
 *
 * 四个节点各自对应一条从翼根辐射出去的主脉（右翼 FORE_MAIN[1] / HIND_MAIN[0]，
 * 左翼是同一套局部坐标、由 pivot 的 scale.x=-1 镜像）。光路就贴着这条脉络跑，
 * 好处有三个：
 *  1) 视觉上"能量沿神经传导"，而不是凭空多出一根线；
 *  2) 光路挂在翼 pivot 里，随翅膀折叠一起动，不会和线框脱节；
 *  3) 少一条独立的曲线几何，也不需要给 z 方向鼓包。
 *
 * 只维护一个实例（同一时刻最多一条路）：切换目标时把它 reparent 到对应翼的 pivot。
 * ghost 与 active 两条线都预建好、靠 visible 切换；粒子用**一个** Points（6 顶点）。
 */
import * as THREE from "three";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

import { WING_SPEC, type WingQuadrant } from "./butterfly-scene";
import { MODULE_NODES, type NodeId } from "../nodes";
import { parsePath, type Pt } from "./wing-geometry";
import { nodeLocalPosition } from "./node-rings";
import { toWorldSize } from "./design-space";
import { createFlowDot } from "./glow-texture";
export type LightPathState = "off" | "ghost" | "active" | "dissolving";

const PARTICLE_COUNT = 6;
const SAMPLES = 56;
/** 贴在脉络前方一点，避免和三层 Tube 打架 */
const PATH_Z = 0.18;

/** 每个节点贴着哪条主脉（索引指向 WING_SPEC.main） */
const NODE_VEIN: Record<NodeId, { kind: "fore" | "hind"; index: number }> = {
  problem: { kind: "fore", index: 1 },
  knowledge: { kind: "fore", index: 1 },
  cases: { kind: "hind", index: 0 },
  sandbox: { kind: "hind", index: 0 },
};

export type LightPath = {
  /** 由调用方决定挂在哪（本实现会自己 reparent 到对应翼的 pivot） */
  object: THREE.Group;
  setTarget(node: NodeId | null): void;
  update(dt: number, state: LightPathState): void;
  /** 光路终点的世界坐标：断言它和宝珠重合用 */
  worldEnd(out: THREE.Vector3): THREE.Vector3 | null;
  dispose(): void;
};

export function createLightPath(
  resolution: THREE.Vector2,
  wings: Record<WingQuadrant, THREE.Group>,
): LightPath {
  const group = new THREE.Group();
  group.visible = false;
  group.renderOrder = 4;

  let curve: THREE.CatmullRomCurve3 | null = null;
  let flow = 0;
  let currentParent: THREE.Group | null = null;

  const ghostMaterial = new LineMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.18,
    linewidth: 1.2,
    worldUnits: false,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  ghostMaterial.resolution.copy(resolution);

  const activeMaterial = new LineMaterial({
    color: 0xa5f3fc,
    transparent: true,
    opacity: 0,
    linewidth: 2.4,
    worldUnits: false,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  activeMaterial.resolution.copy(resolution);

  const ghostGeometry = new LineSegmentsGeometry();
  const activeGeometry = new LineGeometry();
  const ghostLine = new LineSegments2(ghostGeometry, ghostMaterial);
  const activeLine = new LineSegments2(activeGeometry, activeMaterial);
  ghostLine.frustumCulled = false;
  activeLine.frustumCulled = false;
  group.add(ghostLine, activeLine);

  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(new Array(PARTICLE_COUNT * 3).fill(0), 3),
  );
  const particleMaterial = new THREE.PointsMaterial({
    map: createFlowDot(),
    color: "#e8feff",
    size: toWorldSize(9),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const particles = new THREE.Points(particleGeometry, particleMaterial);
  particles.frustumCulled = false;
  group.add(particles);

  /** 设计坐标（绝对）→ 该翼 pivot 的局部坐标 */
  const local = (p: Pt, hinge: Pt): THREE.Vector3 => {
    const dx = (p[0] - hinge[0]) / 100;
    const dy = -(p[1] - hinge[1]) / 100;
    return new THREE.Vector3(dx, dy, PATH_Z);
  };

  function rebuild() {
    if (!curve) {
      group.visible = false;
      return;
    }

    const points = curve.getSpacedPoints(SAMPLES);
    activeGeometry.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));

    /* 虚线：按采样点每 3 段亮 1 段，视觉上就是均匀虚线 */
    const pairs: number[] = [];
    for (let i = 1; i < points.length; i += 1) {
      if (Math.floor((i - 1) / 3) % 2 !== 0) continue;
      const a = points[i - 1];
      const b = points[i];
      pairs.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    ghostGeometry.setPositions(pairs.length >= 6 ? pairs : new Array(6).fill(0));
  }

  return {
    object: group,

    setTarget(nodeId) {
      if (!nodeId) {
        curve = null;
        group.visible = false;
        return;
      }

      const node = MODULE_NODES.find((item) => item.id === nodeId);
      const mapping = NODE_VEIN[nodeId];
      if (!node || !mapping) return;

      const spec = WING_SPEC[mapping.kind];
      const hinge = spec.hinge;
      const vein = spec.main[mapping.index] ?? spec.main[0];
      if (!vein) return;

      /* 起点取核心在翼局部坐标里的位置，让它读起来是"从能量核出发"，
         然后立刻接入那条主脉 —— 中间没有另造的曲线。 */
      const coreLocal = local([720, 486], hinge);
      const veinPoints = (parsePath(vein)[0] ?? []).map((p) => local(p, hinge));

      /* 沿脉络走到**离节点最近的采样点**就截断，再补一个环心点。
         不截断的话光路会一路冲到翼尖，"落到宝珠上"就变成从旁边擦过去。 */
      const pearl = nodeLocalPosition(node);
      let cut = 0;
      let nearestSq = Number.POSITIVE_INFINITY;
      veinPoints.forEach((p, index) => {
        const dSq = (p.x - pearl.x) ** 2 + (p.y - pearl.y) ** 2;
        if (dSq < nearestSq) {
          nearestSq = dSq;
          cut = index;
        }
      });

      curve = new THREE.CatmullRomCurve3(
        [coreLocal, ...veinPoints.slice(0, cut + 1), new THREE.Vector3(pearl.x, pearl.y, PATH_Z)],
        false,
        "catmullrom",
        0.4,
      );

      /* reparent：光路必须挂在翼 pivot 里，才会跟着折叠一起动 */
      const quadrant = `${node.side}${mapping.kind === "fore" ? "Top" : "Bottom"}` as WingQuadrant;
      const target = wings[quadrant];
      if (target && target !== currentParent) {
        currentParent = target;
        target.add(group);
      }
      /* 左翼靠 pivot 的负缩放镜像，局部坐标与右翼完全一致；
         核心在镜像轴上，它的局部 x 两侧相同，所以不需要手动再翻一次。 */

      rebuild();
      flow = 0;
    },

    update(dt, state) {
      if (state === "off" || !curve) {
        group.visible = false;
        particleMaterial.opacity = 0;
        return;
      }

      group.visible = true;
      ghostLine.visible = state === "ghost";
      activeLine.visible = state === "active" || state === "dissolving";

      if (state === "ghost") {
        activeMaterial.opacity = 0;
        particleMaterial.opacity = 0;
        return;
      }

      const direction = state === "dissolving" ? -1 : 1;
      flow = (flow + (dt * direction) / 1.6 + 1) % 1;

      const attr = particleGeometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < PARTICLE_COUNT; i += 1) {
        const t = (flow + i / PARTICLE_COUNT) % 1;
        const point = curve.getPointAt(Math.min(0.999, Math.max(0.001, t)));
        attr.setXYZ(i, point.x, point.y, point.z);
      }
      attr.needsUpdate = true;

      if (state === "active") {
        activeMaterial.opacity = 0.85;
        particleMaterial.opacity = 0.95;
      } else {
        activeMaterial.opacity = Math.max(0, activeMaterial.opacity - dt * 2.2);
        particleMaterial.opacity = Math.max(0, particleMaterial.opacity - dt * 1.6);
      }
    },

    worldEnd(out) {
      if (!curve) return null;
      /* 曲线在翼 pivot 局部坐标里，终点必须换算到世界才和宝珠可比 */
      curve.getPointAt(1, out);
      group.updateWorldMatrix(true, false);
      return group.localToWorld(out);
    },

    dispose() {
      ghostGeometry.dispose();
      activeGeometry.dispose();
      particleGeometry.dispose();
      ghostMaterial.dispose();
      activeMaterial.dispose();
      particleMaterial.dispose();
      particleMaterial.map?.dispose();
    },
  };
}
