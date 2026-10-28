/* 旗舰档：在已验证的节能档线框蝴蝶之上，叠出真正的立体结构。
 *
 * 做法是「组合」而不是「另写一套」：先拿 buildEcoButterfly() 的完整场景，
 * 再往每个翼 pivot 里塞翼膜与三层 Tube 脉络，替换能量核，加穹顶与节点 3D 环。
 * 这样线框细节（28 条细脉、虚线 cell、sparks）一行都不用重写，
 * 两档共用同一份几何数据，不会出现「改了旗舰档、节能档悄悄坏掉」的分叉。
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { buildEcoButterfly, WING_SPEC, type ButterflyParts, type WingQuadrant } from "./butterfly-scene";
import { CORE, cubicSegments, parsePath, type Pt } from "./wing-geometry";
import { MODULE_NODES } from "../nodes";
import { fractionToDesignPx, toWorld, toWorldSize } from "./design-space";
import { createDomeGrid } from "./glow-texture";

/** 主脉三层排布：前后各 14 设计像素，中间层略微缩小制造视差 */
const MAIN_LAYERS: Array<{ zPx: number; scale: number }> = [
  { zPx: 14, scale: 1 },
  { zPx: 0, scale: 0.985 },
  { zPx: -14, scale: 0.97 },
];
/**
 * 细脉只铺两层。三层时四片翼的三角形直接冲到 147k、draw call 149，
 * 超掉阶段一预算；细脉本来只有 0.55px 级别的视觉权重，第三层的视差看不出来，
 * 砍掉它换来的是预算内 40% 的余量。
 */
const FINE_LAYERS: Array<{ zPx: number; scale: number }> = [
  { zPx: 10, scale: 1 },
  { zPx: -10, scale: 0.985 },
];

/**
 * 主脉更粗、分段更多；细脉降规格，因为它是背景纹理而不是结构。
 *
 * 半径单位是世界单位（1 = 100 设计像素），相机在 11.6 处、fov 45°，
 * 所以 0.009 就是直径约 1.8 设计像素的管子 —— 第一版按「像素」直觉给数，
 * 结果细脉糊成一捆吸管，把线框的精致感全压掉了。这里按 1px≈0.005 反推。
 */
const VEIN_DETAIL: Record<"main" | "fine", { radius: number; tubular: number; radial: number }> = {
  main: { radius: 0.014, tubular: 20, radial: 4 },
  fine: { radius: 0.0055, tubular: 12, radial: 3 },
};

export type FlagshipBuild = {
  parts: ButterflyParts;
  lights: THREE.Object3D[];
};

/**
 * 打上标记，运行时降档就能整批隐藏（见 ButterflyScene.tsx 的 applyTier）。
 * 降档不重建几何：旗舰档本身就是「节能档 + 立体附加层」。
 */
function mark(object: THREE.Object3D): THREE.Object3D {
  object.userData.flagshipOnly = true;
  return object;
}

/** 设计坐标（相对 hinge）→ 该层的三维局部坐标 */
function layerPoint(p: Pt, origin: Pt, layer: { scale: number; zPx: number }): THREE.Vector3 {
  return new THREE.Vector3(
    ((p[0] - origin[0]) / 100) * layer.scale,
    (-(p[1] - origin[1]) / 100) * layer.scale,
    toWorldSize(layer.zPx),
  );
}

/**
 * 把一批路径铺成三层 Tube 并合并成**一个**几何体。
 * 不合并的话单侧细脉 16×3=48 根就是 48 个 draw call，四片翼直接爆表。
 */
function mergedVeinGeometry(
  paths: string[],
  origin: Pt,
  layers: Array<{ zPx: number; scale: number }>,
  detail: { radius: number; tubular: number; radial: number },
  parts: ButterflyParts,
): THREE.BufferGeometry | null {
  const pieces: THREE.BufferGeometry[] = [];

  for (const layer of layers) {
    for (const d of paths) {
      for (const spec of cubicSegments(d)) {
        const curve = new THREE.CubicBezierCurve3(
          layerPoint(spec.from, origin, layer),
          layerPoint(spec.c1, origin, layer),
          layerPoint(spec.c2, origin, layer),
          layerPoint(spec.to, origin, layer),
        );
        pieces.push(
          new THREE.TubeGeometry(curve, detail.tubular, detail.radius, detail.radial, false),
        );
      }
    }
  }

  if (!pieces.length) return null;
  const merged = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  if (merged) parts.disposables.push(merged);
  return merged;
}

function addMembraneAndTubes(parts: ButterflyParts) {
  for (const [key, wing] of Object.entries(parts.wings) as Array<[WingQuadrant, THREE.Group]>) {
    const side = key.startsWith("left") ? "left" : "right";
    const kind = key.endsWith("Top") ? "fore" : "hind";
    const spec = WING_SPEC[kind];
    const origin = spec.hinge;

    /* 翼膜：用已采样的轮廓折线铺成 Shape 再三角化。
       刻意压到 0.075 不透明度 —— 方案要「立体但不厚重」。 */
    const outline = parsePath(spec.outline)[0];
    const shape = new THREE.Shape();
    outline.forEach(([x, y], index) => {
      const lx = (x - origin[0]) / 100;
      const ly = -(y - origin[1]) / 100;
      if (index === 0) shape.moveTo(lx, ly);
      else shape.lineTo(lx, ly);
    });
    shape.closePath();

    const membraneGeometry = new THREE.ShapeGeometry(shape, 12);
    const membraneMaterial = new THREE.MeshStandardMaterial({
      color: "#0b2a4a",
      emissive: "#1d4ed8",
      emissiveIntensity: 0.35,
      metalness: 0.15,
      roughness: 0.35,
      transparent: true,
      opacity: 0.075,
      /* 左翼靠 pivot.scale.x=-1 镜像，FrontSide 会把整片剔掉 —— 上一轮踩过 */
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    parts.disposables.push(membraneGeometry, membraneMaterial);

    const membrane = new THREE.Mesh(membraneGeometry, membraneMaterial);
    membrane.renderOrder = 1;
    wing.add(mark(membrane));

    const addVeins = (
      paths: string[],
      layers: Array<{ zPx: number; scale: number }>,
      detail: { radius: number; tubular: number; radial: number },
      color: string,
      emissive: string,
      emissiveIntensity: number,
      opacity: number,
      layer: "veinBright" | "veinGlow",
    ) => {
      const geometry = mergedVeinGeometry(paths, origin, layers, detail, parts);
      if (!geometry) return;
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity,
        metalness: 0.1,
        roughness: 0.45,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      parts.disposables.push(material);
      parts.brightness.push({ side, layer, material, base: opacity });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      wing.add(mark(mesh));
    };

    addVeins(spec.main, MAIN_LAYERS, VEIN_DETAIL.main, "#7dd3fc", "#38bdf8", 0.7, 0.85, "veinBright");
    addVeins(spec.fine, FINE_LAYERS, VEIN_DETAIL.fine, "#38bdf8", "#1d4ed8", 0.35, 0.6, "veinGlow");
  }
}

/** 节点 3D 环：外环平铺 + 内环倾斜，hover 时由 animator 提亮 */
function addNodeRings(parts: ButterflyParts) {
  for (const node of MODULE_NODES) {
    const [px, py] = fractionToDesignPx(node.x, node.y);
    const holder = new THREE.Group();
    holder.position.set(...toWorld(px, py));

    const outerGeometry = new THREE.TorusGeometry(toWorldSize(46), toWorldSize(1.1), 6, 56);
    const innerGeometry = new THREE.TorusGeometry(toWorldSize(30), toWorldSize(1.6), 6, 40);
    parts.disposables.push(outerGeometry, innerGeometry);

    const outerMaterial = new THREE.MeshStandardMaterial({
      color: "#7dd3fc",
      emissive: "#38bdf8",
      emissiveIntensity: 0.8,
      metalness: 0.2,
      roughness: 0.4,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const innerMaterial = outerMaterial.clone();
    innerMaterial.opacity = 0.75;
    innerMaterial.emissiveIntensity = 1.1;
    parts.disposables.push(outerMaterial, innerMaterial);

    const outer = new THREE.Mesh(outerGeometry, outerMaterial);
    const inner = new THREE.Mesh(innerGeometry, innerMaterial);
    inner.rotation.x = Math.PI / 2.6;
    inner.rotation.y = Math.PI / 5;
    outer.renderOrder = 3;
    inner.renderOrder = 3;
    holder.add(outer, inner);

    parts.brightness.push({ side: node.side, layer: "socket", material: outerMaterial, base: 0.55 });
    parts.brightness.push({ side: node.side, layer: "socket", material: innerMaterial, base: 0.75 });
    parts.nodeRings.push(holder);
    parts.root.add(mark(holder));
  }
}

/** 能量核重构：发光球体 + 三层不同轴向的 Torus，替换掉原来的 sprite orb */
function rebuildCore(parts: ButterflyParts) {
  for (const child of parts.corePulse.children) {
    if (child.name === "legacyOrb" || child.name === "legacyGlint") child.visible = false;
  }

  const sphereGeometry = new THREE.SphereGeometry(toWorldSize(CORE.orbR), 28, 18);
  const sphereMaterial = new THREE.MeshStandardMaterial({
    color: "#e8feff",
    emissive: "#7dd3fc",
    emissiveIntensity: 2.1,
    metalness: 0,
    roughness: 0.2,
  });
  parts.disposables.push(sphereGeometry, sphereMaterial);
  const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
  sphere.renderOrder = 4;
  parts.corePulse.add(mark(sphere));

  const ringSpecs = [
    { radius: 44, tilt: [0, 0, 0] },
    { radius: 58, tilt: [Math.PI / 2.1, 0.35, 0] },
    { radius: 70, tilt: [0.5, Math.PI / 2.4, 0.2] },
  ];
  ringSpecs.forEach((spec, index) => {
    const geometry = new THREE.TorusGeometry(toWorldSize(spec.radius), toWorldSize(0.9), 5, 64);
    const material = new THREE.MeshStandardMaterial({
      color: "#a0ebff",
      emissive: "#2563eb",
      emissiveIntensity: 1.2,
      metalness: 0.3,
      roughness: 0.3,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    parts.disposables.push(geometry, material);
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.set(spec.tilt[0], spec.tilt[1], spec.tilt[2]);
    ring.renderOrder = 3;
    /* 三圈各自以不同速度自转，animator 读 coreRings 逐个推进 */
    ring.userData.spin = index + 1;
    parts.coreRings.push(ring);
    parts.corePulse.add(mark(ring));
    parts.brightness.push({ side: null, layer: "core", material, base: 0.72 });
  });
}

/** 深空穹顶：BackSide 大球 + 内壁发光经纬网格，极慢自转 */
function addDome(parts: ButterflyParts) {
  const texture = createDomeGrid();
  const geometry = new THREE.SphereGeometry(58, 24, 12);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  });
  parts.disposables.push(texture, geometry, material);
  const dome = new THREE.Mesh(geometry, material);
  dome.renderOrder = 0;
  parts.dome = dome;
  parts.root.add(mark(dome));
}

/** 两盏对向平行光负责「朝相机一侧亮冰蓝、背面暗紫」；节能档不挂灯 */
export function createFlagshipLights(): THREE.Object3D[] {
  const key = new THREE.DirectionalLight(0x7dd3fc, 2.4);
  key.position.set(4, 5, 9);
  const rim = new THREE.DirectionalLight(0x4c1d95, 1.8);
  rim.position.set(-5, -3, -9);
  const ambient = new THREE.AmbientLight(0x0b1a33, 1.1);
  return [key, rim, ambient];
}

export function buildFlagshipButterfly(resolution: THREE.Vector2): FlagshipBuild {
  const parts = buildEcoButterfly(resolution);
  parts.mode = "flagship";

  addMembraneAndTubes(parts);
  addNodeRings(parts);
  rebuildCore(parts);
  addDome(parts);

  return { parts, lights: createFlagshipLights() };
}
