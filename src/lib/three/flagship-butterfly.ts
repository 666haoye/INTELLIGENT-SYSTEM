/* 旗舰档：在已验证的节能档线框蝴蝶之上，叠出真正的立体结构。
 *
 * 做法是「组合」而不是「另写一套」：先拿 buildEcoButterfly() 的完整场景，
 * 再往每个翼 pivot 里塞翼膜、神经分形树与能量核。
 * 节点环两档共用，不在这里建（见 node-rings.ts）。
 * 这样线框细节（28 条细脉、虚线 cell、sparks）一行都不用重写，
 * 两档共用同一份几何数据，不会出现「改了旗舰档、节能档悄悄坏掉」的分叉。
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { buildEcoButterfly, WING_SPEC, type ButterflyParts, type WingQuadrant } from "./butterfly-scene";
import { CORE, parsePath } from "./wing-geometry";
import { toWorldSize } from "./design-space";
import { createFlowDot } from "./glow-texture";
import { NODE_VEIN } from "./light-path";
import { buildNerveTree, nerveSeed, sampleTrunk, taperedTube } from "./wing-nerves";

/**
 * 神经分形树的管规格（世界单位，1 = 100 设计像素）。
 *
 * 半径阶梯按参考图定：主干 0.021→0.007（根粗梢细）→ 一级分支 0.006→0.0026
 * → 末端突触 0.0026→0.0011（Points 收尾）。恒径管会读成"荧光棒"，所以主干与
 * 肋脉都用 taperedTube 变径；全部单层铺在 z=0，层次感交给翼膜与节点环。
 */
const NERVE_DETAIL = {
  trunk: { root: 0.021, tip: 0.007, tubular: 36, radial: 6 },
  rib: { root: 0.0065, tip: 0.0035, tubular: 16, radial: 4 },
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

function addMembraneAndTubes(parts: ButterflyParts) {
  /* 突触发光点：四翼共用一张 CanvasTexture（createFlowDot 不缓存，调四次会多出三张纹理） */
  const synapseTexture = createFlowDot();
  parts.disposables.push(synapseTexture);

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
    /* 分形枝只允许长在翼膜轮廓内 */
    const bounds = outline.map(
      ([x, y]) => new THREE.Vector2((x - origin[0]) / 100, -(y - origin[1]) / 100),
    );

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

    /* ---- 主神经：每翼一条，就是 light-path 贴着跑的那条 NODE_VEIN 主干 ----
       单独成 mesh 并打 nerveTrunk 标记：后续阶段的"点亮 / 粒子流"只操作它。 */
    const mapping = kind === "fore" ? NODE_VEIN.problem : NODE_VEIN.cases;
    const trunkPath = spec.main[mapping.index] ?? spec.main[0];
    const trunkPoints = sampleTrunk(trunkPath, origin);
    const trunkGeometry = taperedTube(
      new THREE.CatmullRomCurve3(trunkPoints, false, "catmullrom", 0.4),
      NERVE_DETAIL.trunk.tubular,
      NERVE_DETAIL.trunk.radial,
      (t) =>
        THREE.MathUtils.lerp(
          NERVE_DETAIL.trunk.root,
          NERVE_DETAIL.trunk.tip,
          Math.pow(t, 1.15),
        ),
    );
    const trunkMaterial = new THREE.MeshStandardMaterial({
      color: "#7dd3fc",
      emissive: "#38bdf8",
      emissiveIntensity: 0.85,
      metalness: 0.1,
      roughness: 0.4,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    parts.disposables.push(trunkGeometry, trunkMaterial);
    parts.brightness.push({ side, layer: "veinBright", material: trunkMaterial, base: 0.9 });
    const trunkMesh = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunkMesh.name = `nerve-trunk-${key}`;
    trunkMesh.renderOrder = 2;
    trunkMesh.frustumCulled = false;
    mark(trunkMesh).userData.nerveTrunk = true;
    wing.add(trunkMesh);

    /* ---- 肋脉 + 分形分支：一个几何、一个材质 ----
       肋脉只留首、中、尾三条做骨架，其余交给分形树 —— 保留 5~6 条就是"直线雨伞"。
       每条肋脉也长一层较短的分支，把翼面外侧填满。 */
    const tree = buildNerveTree(trunkPoints, nerveSeed(key), { lengthScale: 1.05, bounds });
    const remainingRibs = spec.main.filter((_, index) => index !== mapping.index);
    const ribPaths =
      remainingRibs.length > 3
        ? [
            remainingRibs[0],
            remainingRibs[Math.floor(remainingRibs.length / 2)],
            remainingRibs[remainingRibs.length - 1],
          ]
        : remainingRibs;
    const ribSamples = ribPaths.map((d) => sampleTrunk(d, origin));
    const ribPieces = ribSamples.map((points) =>
      taperedTube(
        new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.4),
        NERVE_DETAIL.rib.tubular,
        NERVE_DETAIL.rib.radial,
        (t) => THREE.MathUtils.lerp(NERVE_DETAIL.rib.root, NERVE_DETAIL.rib.tip, t),
      ),
    );
    const ribTrees = ribSamples.map((points, index) =>
      buildNerveTree(points, nerveSeed(key) + 97 * (index + 1), {
        lengthScale: 0.8,
        stride: 1,
        anchorRatio: 0.88,
        radiusScale: 0.7,
        bounds,
      }),
    );
    const synapses = [
      ...tree.synapses,
      ...ribTrees.flatMap((item) => item.synapses),
    ];
    const pieces = [
      ...ribPieces,
      ...tree.branchPieces,
      ...ribTrees.flatMap((item) => item.branchPieces),
    ];
    const ribGeometry = mergeGeometries(pieces, false);
    for (const piece of pieces) piece.dispose();
    if (ribGeometry) {
      parts.disposables.push(ribGeometry);
      const ribMaterial = new THREE.MeshStandardMaterial({
        color: "#7dd3fc",
        emissive: "#38bdf8",
        emissiveIntensity: 0.32,
        metalness: 0.1,
        roughness: 0.45,
        transparent: true,
        opacity: 0.68,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      parts.disposables.push(ribMaterial);
      parts.brightness.push({ side, layer: "veinGlow", material: ribMaterial, base: 0.68 });
      const ribMesh = new THREE.Mesh(ribGeometry, ribMaterial);
      ribMesh.renderOrder = 2;
      ribMesh.frustumCulled = false;
      wing.add(mark(ribMesh));
    }

    /* ---- 末端突触：分支尖端的发光点，复用光路粒子那套 CanvasTexture ---- */
    if (synapses.length) {
      const positions = new Float32Array(synapses.length * 3);
      synapses.forEach((point, index) => {
        positions[index * 3] = point.x;
        positions[index * 3 + 1] = point.y;
        positions[index * 3 + 2] = point.z;
      });
      const synapseGeometry = new THREE.BufferGeometry();
      synapseGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const synapseMaterial = new THREE.PointsMaterial({
        map: synapseTexture,
        color: "#e8feff",
        size: toWorldSize(8.5),
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      parts.disposables.push(synapseGeometry, synapseMaterial);
      parts.brightness.push({ side, layer: "veinGlow", material: synapseMaterial, base: 0.9 });
      const synapseCloud = new THREE.Points(synapseGeometry, synapseMaterial);
      synapseCloud.renderOrder = 2;
      synapseCloud.frustumCulled = false;
      wing.add(mark(synapseCloud));
    }
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
  rebuildCore(parts);

  return { parts, lights: createFlagshipLights() };
}
