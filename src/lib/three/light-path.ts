/* 中心 → 节点的光路：hover 出虚影，镜头稳定后点亮并跑粒子，返回时反向溶解。
 *
 * 只维护一个实例（同一时刻最多一条路），两种线型都预先建好、靠 visible 切换 ——
 * 这样状态切换不产生建/销几何的开销，draw call 也固定：最多 1 条线 + 1 个粒子层。
 * 粒子刻意用**一个** Points（6 个顶点）而不是 6 个 Sprite：后者是 6 次 draw call。
 */
import * as THREE from "three";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

import { MODULE_NODES, type NodeId } from "../nodes";
import { fractionToDesignPx, toWorld, toWorldSize } from "./design-space";
import { createFlowDot } from "./glow-texture";

export type LightPathState = "off" | "ghost" | "active" | "dissolving";

const PARTICLE_COUNT = 6;
const SAMPLES = 56;

export type LightPath = {
  object: THREE.Group;
  setTarget(node: NodeId | null): void;
  update(dt: number, state: LightPathState): void;
  dispose(): void;
};

export function createLightPath(resolution: THREE.Vector2): LightPath {
  const group = new THREE.Group();
  group.visible = false;
  group.renderOrder = 4;

  const coreWorld = new THREE.Vector3(...toWorld(720, 486));

  let curve: THREE.CubicBezierCurve3 | null = null;
  let flow = 0;

  /* 两个线型都建好，按状态切换 visible */
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

  function rebuildGeometry() {
    if (!curve) {
      ghostLine.visible = false;
      activeLine.visible = false;
      particles.visible = false;
      return;
    }

    /* 实线：整条曲线 */
    activeGeometry.setPositions(
      curve.getSpacedPoints(SAMPLES).flatMap((p) => [p.x, p.y, p.z]),
    );

    /* 虚线：按采样点的奇偶段切，视觉上就是均匀虚线，省掉 3D 版的弧长 dash 实现 */
    const points = curve.getSpacedPoints(SAMPLES);
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
      if (!node) return;

      const [px, py] = fractionToDesignPx(node.x, node.y);
      const end = new THREE.Vector3(...toWorld(px, py));
      const mid = coreWorld.clone().lerp(end, 0.5);
      /* 朝镜头鼓一点，光路才有"从屏幕里穿出来"的厚度 */
      mid.z += 0.35;
      curve = new THREE.CubicBezierCurve3(
        coreWorld.clone(),
        coreWorld.clone().lerp(mid, 0.6),
        end.clone().lerp(mid, 0.6),
        end,
      );
      rebuildGeometry();
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

      /* 流动方向：激活时核心→节点，溶解时原地反向并淡出 */
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
        /* 溶解：线先暗下去，粒子跟着回流淡出 */
        activeMaterial.opacity = Math.max(0, activeMaterial.opacity - dt * 2.2);
        particleMaterial.opacity = Math.max(0, particleMaterial.opacity - dt * 1.6);
      }
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
