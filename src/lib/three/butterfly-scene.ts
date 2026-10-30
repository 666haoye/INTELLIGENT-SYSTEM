/* Three.js 场景构建：四翼线框 + 躯干 + 中心能量核 + 翅上光流包。
 * 节点环单独在 node-rings.ts 里建，两档共用。
 *
 * 视觉规格逐条对旧的 globals.css 与 Butterfly.tsx 取值，目标是「静止一帧与改造前的 SVG 等价」，
 * 动画由 wing-animator.ts 接管。
 *
 * 三条必须知道的取舍：
 *  1) 旧 SVG 每条描边都吃 vector-effect: non-scaling-stroke（globals.css:236-240），
 *     即 stroke-width 是**屏幕像素**而非设计像素。这里用 LineMaterial（worldUnits=false）
 *     的屏幕空间线宽等价复刻，数值照抄 CSS。
 *  2) LineMaterial 不支持 stroke-dasharray，所以虚线在几何层面切开（dashPairs）。
 *  3) 每片翼的几何一律用**绕 hinge 的局部坐标**表达，pivot 组放在 hinge 上。
 *     左翼 = 同一个 pivot 位置镜像（x → 1440-x）+ scale.x=-1，
 *     和旧 SVG 的 translate(1440 0) scale(-1 1) 等价，扇动时左右严格对称。
 */
import * as THREE from "three";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

import {
  CENTER_X,
  DESIGN_W,
  PX_PER_UNIT,
  toWorld,
  toWorldSize,
} from "./design-space";
import {
  ANTENNA,
  BODY_INNER,
  BODY_OUTLINE,
  BODY_RIBS,
  BODY_SPINE,
  CORE,
  CURRENTS,
  FOREWING,
  FORE_BRIGHT,
  FORE_CELL,
  FORE_FINE,
  FORE_MAIN,
  FORE_SPARKS,
  FLOW_LANES,
  HEAD,
  HEAD_DOT,
  HINDWING,
  HIND_BRIGHT,
  HIND_CELL,
  HIND_FINE,
  HIND_MAIN,
  HIND_SPARKS,
  INNER_SHAPES,
  type Pt,
  type Polyline,
  circlePoly,
  cubicFromPath,
  dashPairs,
  parsePath,
  parsePaths,
  polylinePairs,
  scaleAbout,
} from "./wing-geometry";
import type { WingSide } from "../nodes";
import type { RenderTier } from "../environment";
import { createBeam, createCoreGlow, createCoreOrb, createFlowDot } from "./glow-texture";

/** @types/three 0.186 没有声明 linewidth，但运行时 LineMaterial 确实有这个 getter/setter */
export type FatMaterial = LineMaterial & { linewidth: number };

/** 亮度分组：animator 按 (side, layer) 查表调 opacity */
export type BrightnessLayer =
  | "wingGlow"
  | "wingLine"
  | "veinGlow"
  | "veinBright"
  | "core"
  | "body";

export type BrightnessTarget = {
  side: WingSide | null;
  layer: BrightnessLayer;
  material: THREE.Material & { opacity: number };
  base: number;
};

export type WingQuadrant = "leftTop" | "rightTop" | "leftBottom" | "rightBottom";

export type FlowPacket = {
  sprite: THREE.Sprite;
  /** Points.material 的类型是 Material | Material[]，这里直接握住具体材质省得每次窄化 */
  glowMaterial: THREE.SpriteMaterial;
  /** 支点局部坐标系里的三次贝塞尔，保证包随翅膀一起转 */
  curve: THREE.CubicBezierCurve3;
  duration: number;
  offset: number;
  reverse: boolean;
  laneSide: WingSide;
};

export type ButterflyParts = {
  mode: RenderTier;
  root: THREE.Group;
  wings: Record<WingQuadrant, THREE.Group>;
  antennae: Record<WingSide, THREE.Group>;
  coreRoot: THREE.Group;
  corePulse: THREE.Group;
  coreAura: THREE.Sprite;
  coreOuterRing: FatMaterial;
  flowPackets: FlowPacket[];
  brightness: BrightnessTarget[];
  disposables: Array<{ dispose(): void }>;
  lineMaterials: FatMaterial[];
  /** 旗舰档专属：三轴能量环，节能档为空 */
  coreRings: THREE.Object3D[];
};

/* ==========================================================
   坐标：一律相对支点（hinge）表达
   ========================================================== */

/** 设计像素的偏移量 → 世界偏移量（y 轴翻转） */
export function offset(dx: number, dy: number): [number, number] {
  return [dx / PX_PER_UNIT, -dy / PX_PER_UNIT];
}

function localPairs(pairs: [Pt, Pt][], origin: Pt): number[] {
  const out: number[] = [];
  for (const [a, b] of pairs) {
    const [ax, ay] = offset(a[0] - origin[0], a[1] - origin[1]);
    const [bx, by] = offset(b[0] - origin[0], b[1] - origin[1]);
    out.push(ax, ay, 0, bx, by, 0);
  }
  return out;
}

function localPolys(polys: Polyline[], origin: Pt): number[] {
  return localPairs(polylinePairs(polys), origin);
}

/* ==========================================================
   材质与网格小工具（几何统一登记进 disposables）
   ========================================================== */

export function makeFatMaterial(
  widthPx: number,
  color: THREE.ColorRepresentation,
  opacity: number,
  resolution: THREE.Vector2,
): FatMaterial {
  const material = new LineMaterial({
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false,
    worldUnits: false,
    blending: THREE.AdditiveBlending,
    /* 左翼靠 pivot.scale.x = -1 镜像，会把 fat line 的三角形绕序翻面；
       默认 FrontSide 会把它整片剔掉（画出来就是左翼凭空消失）。 */
    side: THREE.DoubleSide,
  }) as FatMaterial;
  material.linewidth = widthPx;
  material.color.set(color);
  material.resolution.copy(resolution);
  return material;
}

function fatSegments(
  positions: number[],
  material: FatMaterial,
  parts: ButterflyParts,
  colors: number[] | null = null,
): LineSegments2 {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  if (colors) geometry.setColors(colors);
  parts.disposables.push(geometry);
  const mesh = new LineSegments2(geometry, material);
  mesh.renderOrder = 2;
  /* 扇动后包围盒会变，交给三做裁剪判定容易整片消失，直接关掉 */
  mesh.frustumCulled = false;
  return mesh;
}

function fatLine(positions: number[], material: FatMaterial, parts: ButterflyParts): LineSegments2 {
  const geometry = new LineGeometry();
  geometry.setPositions(positions);
  parts.disposables.push(geometry);
  const line = new LineSegments2(geometry, material);
  line.renderOrder = 2;
  line.frustumCulled = false;
  return line;
}

export function register(
  parts: ButterflyParts,
  material: FatMaterial,
  side: WingSide | null,
  layer: BrightnessLayer,
  base: number,
): FatMaterial {
  parts.disposables.push(material);
  parts.lineMaterials.push(material);
  parts.brightness.push({ side, layer, material, base });
  return material;
}

/* 旧 wingStroke 渐变：x1 0% y1 100% → x2 100% y2 0%（左下到右上）。
 * LineMaterial 的逐顶点颜色只有 RGB，因为整体加色混合且背景近黑，
 * 把 stop-opacity 折进 RGB（预乘）在视觉上等价。 */
const WING_RAMP: Array<{ t: number; color: THREE.Color }> = [
  { t: 0, color: new THREE.Color("#1d4ed8").multiplyScalar(0.42) },
  { t: 0.46, color: new THREE.Color("#38bdf8").multiplyScalar(0.88) },
  { t: 1, color: new THREE.Color("#e0fcff") },
];

const rampScratch = new THREE.Color();

function rampColorAt(t: number): THREE.Color {
  const clamped = Math.min(1, Math.max(0, t));
  for (let i = 1; i < WING_RAMP.length; i += 1) {
    const a = WING_RAMP[i - 1];
    const b = WING_RAMP[i];
    if (clamped <= b.t) {
      const k = (clamped - a.t) / (b.t - a.t || 1);
      return rampScratch.copy(a.color).lerp(b.color, k);
    }
  }
  return rampScratch.copy(WING_RAMP[WING_RAMP.length - 1].color);
}

/** pairs 里的坐标是相对 hinge 的设计偏移；渐变轴按整片翼的包围盒归一 */
function rampColors(pairs: [Pt, Pt][], box: [number, number, number, number]): number[] {
  const [minX, minY, maxX, maxY] = box;
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const out: number[] = [];
  for (const [a, b] of pairs) {
    for (const p of [a, b]) {
      /* SVG 的 y 向下，渐变从底部起算，所以 y 分量取反 */
      const t = ((p[0] - minX) / spanX + (1 - (p[1] - minY) / spanY)) / 2;
      const color = rampColorAt(t);
      out.push(color.r, color.g, color.b);
    }
  }
  return out;
}

function bboxOf(polys: Polyline[]): [number, number, number, number] {
  const flat = polys.flat();
  const xs = flat.map((p) => p[0]);
  const ys = flat.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function sprite(
  parts: ButterflyParts,
  map: THREE.Texture,
  color: THREE.ColorRepresentation,
  opacity: number,
  sizePx: number,
): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map,
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  parts.disposables.push(material);
  const object = new THREE.Sprite(material);
  object.scale.setScalar(toWorldSize(sizePx));
  object.renderOrder = 1;
  return object;
}

/* ==========================================================
   单片翅膀（以右翼为模板，左翼靠 pivot 镜像）
   ========================================================== */

type WingKind = "fore" | "hind";

export const WING_SPEC: Record<
  WingKind,
  {
    outline: string;
    inner: { scale: number; cx: number; cy: number };
    main: string[];
    fine: string[];
    cell: string;
    bright: string[];
    currents: string[];
    sparks: Pt[];
    hinge: Pt;
  }
> = {
  fore: {
    outline: FOREWING,
    inner: { scale: 0.955, cx: 720, cy: 470 },
    main: FORE_MAIN,
    fine: FORE_FINE,
    cell: FORE_CELL,
    bright: FORE_BRIGHT,
    currents: CURRENTS.slice(0, 2),
    sparks: FORE_SPARKS,
    hinge: [748, 486],
  },
  hind: {
    outline: HINDWING,
    inner: { scale: 0.95, cx: 720, cy: 560 },
    main: HIND_MAIN,
    fine: HIND_FINE,
    cell: HIND_CELL,
    bright: HIND_BRIGHT,
    currents: CURRENTS.slice(2),
    sparks: HIND_SPARKS,
    hinge: [752, 556],
  },
};

const GLOW_LAYERS = [
  { width: 10, color: "#1d4ed8", opacity: 0.1 },
  { width: 4, color: "#0ea5e9", opacity: 0.18 },
  { width: 2.4, color: "#38bdf8", opacity: 0.25 },
];

/** 返回 pivot 组：它的位置在 hinge，子坐标全部相对 hinge */
function buildWing(
  kind: WingKind,
  side: WingSide,
  resolution: THREE.Vector2,
  parts: ButterflyParts,
): THREE.Group {
  const spec = WING_SPEC[kind];
  const origin = spec.hinge;
  const pivot = new THREE.Group();
  const [hx, hy] = side === "left" ? toWorld(DESIGN_W - origin[0], origin[1]) : toWorld(origin[0], origin[1]);
  pivot.position.set(hx, hy, 0);
  if (side === "left") pivot.scale.x = -1;
  pivot.name = `${side}${kind === "fore" ? "Top" : "Bottom"}Wing`;

  const outlinePolys = parsePath(spec.outline);
  const outlinePairs = polylinePairs(outlinePolys);
  const box = bboxOf(outlinePolys);

  /* .wing-glows 三层粗描边 */
  for (const glow of GLOW_LAYERS) {
    const material = register(
      parts,
      makeFatMaterial(glow.width, glow.color, glow.opacity, resolution),
      side,
      "wingGlow",
      glow.opacity,
    );
    pivot.add(fatLine(localPairs(outlinePairs, origin), material, parts));
  }

  /* .wing-outline 1.5px + 渐变 */
  {
    const material = makeFatMaterial(1.5, "#ffffff", 1, resolution);
    material.vertexColors = true;
    register(parts, material, side, "wingLine", 0.96);
    pivot.add(
      fatSegments(localPairs(outlinePairs, origin), material, parts, rampColors(outlinePairs, box)),
    );
  }

  /* .wing-inner 0.9px #7dd3fc α.38 */
  {
    const inner = scaleAbout(
      parsePath(spec.outline),
      spec.inner.scale,
      spec.inner.cx,
      spec.inner.cy,
    );
    const material = register(
      parts,
      makeFatMaterial(0.9, "#7dd3fc", 0.38, resolution),
      side,
      "wingLine",
      0.38,
    );
    pivot.add(fatSegments(localPolys(inner, origin), material, parts));
  }

  /* .vein-glow 3.4px #1d4ed8 α.09（覆盖全部主脉） */
  const mainPolys = parsePaths(spec.main);
  {
    const material = register(
      parts,
      makeFatMaterial(3.4, "#1d4ed8", 0.09, resolution),
      side,
      "veinGlow",
      0.09,
    );
    pivot.add(fatSegments(localPolys(mainPolys, origin), material, parts));
  }

  /* .vein 0.8px #7dd3fc α.6 */
  {
    const material = register(
      parts,
      makeFatMaterial(0.8, "#7dd3fc", 0.6, resolution),
      side,
      "wingLine",
      0.6,
    );
    pivot.add(fatSegments(localPolys(mainPolys, origin), material, parts));
  }

  /* .vein--fine 0.55px α.35 */
  {
    const material = register(
      parts,
      makeFatMaterial(0.55, "#7dd3fc", 0.35, resolution),
      side,
      "wingLine",
      0.35,
    );
    pivot.add(fatSegments(localPolys(parsePaths(spec.fine), origin), material, parts));
  }

  /* .vein--cell 虚线 3/5 α.45 */
  {
    const material = register(
      parts,
      makeFatMaterial(0.8, "#7dd3fc", 0.45, resolution),
      side,
      "wingLine",
      0.45,
    );
    pivot.add(
      fatSegments(localPairs(dashPairs(parsePath(spec.cell), 3, 5), origin), material, parts),
    );
  }

  /* .vein--bright 0.95px #d8fbff α.75（主脉前两条） */
  {
    const material = register(
      parts,
      makeFatMaterial(0.95, "#d8fbff", 0.75, resolution),
      side,
      "veinBright",
      0.75,
    );
    pivot.add(fatSegments(localPolys(parsePaths(spec.bright), origin), material, parts));
  }

  /* .wing-currents 1px #e0fcff α.38，虚线 2/14 */
  {
    const material = register(
      parts,
      makeFatMaterial(1, "#e0fcff", 0.38, resolution),
      side,
      "veinBright",
      0.38,
    );
    pivot.add(
      fatSegments(localPairs(dashPairs(parsePaths(spec.currents), 2, 14), origin), material, parts),
    );
  }

  /* .wing-sparks：贴在翼面上，必须随翼转，所以也挂在 pivot 下 */
  {
    const positions: number[] = [];
    for (const [x, y] of spec.sparks) {
      const [lx, ly] = offset(x - origin[0], y - origin[1]);
      positions.push(lx, ly, 0);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    parts.disposables.push(geometry);
    const material = new THREE.PointsMaterial({
      map: flowDotTexture(parts),
      color: "#d8fbff",
      size: toWorldSize(5),
      transparent: true,
      opacity: 0.48,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    parts.disposables.push(material);
    parts.brightness.push({ side, layer: "wingLine", material, base: 0.48 });
    const cloud = new THREE.Points(geometry, material);
    cloud.renderOrder = 2;
    cloud.frustumCulled = false;
    pivot.add(cloud);
  }

  return pivot;
}

/** 光流包用的贴图建一次就够，挂在 parts 上复用 */
export function flowDotTexture(parts: ButterflyParts): THREE.Texture {
  const cache = parts.root.userData.flowTexture as THREE.Texture | undefined;
  if (cache) return cache;
  const texture = createFlowDot();
  parts.disposables.push(texture);
  parts.root.userData.flowTexture = texture;
  return texture;
}

/** 翅上光流包：曲线坐标同样相对 hinge，才能跟着翅膀一起扇 */
function buildFlowPackets(parts: ButterflyParts, resolution: THREE.Vector2): void {
  void resolution;
  const texture = flowDotTexture(parts);

  for (const lane of FLOW_LANES) {
    const [from, c1, c2, to] = cubicFromPath(lane.d);
    /* fore-* 车道走上翼，hind-* 走下翼（与旧 SVG 的路径位置一致） */
    const kind: WingKind = lane.id.startsWith("hind") ? "hind" : "fore";
    const origin = WING_SPEC[kind].hinge;

    for (const side of ["right", "left"] as const) {
      const flip = (p: Pt): Pt => (side === "left" ? [DESIGN_W - p[0], p[1]] : p);
      const local = (p: Pt): THREE.Vector3 => {
        const [x, y] = offset(flip(p)[0] - origin[0], flip(p)[1] - origin[1]);
        return new THREE.Vector3(x, y, 0);
      };
      const curve = new THREE.CubicBezierCurve3(local(from), local(c1), local(c2), local(to));

      const glow = sprite(parts, texture, "#ffffff", 0, 20);
      /* 曾经这里还挂了一个独立的白色 Points 当「内核」，10 个包就是 20 次 draw call。
         flowDotGlow 贴图本身中心就是 0.8 alpha 的近白点，去掉那层几乎看不出差别，
         却省下 10 个 draw call。 */
      const holder = new THREE.Group();
      holder.add(glow);
      const pivot = parts.wings[`${side}${kind === "fore" ? "Top" : "Bottom"}` as WingQuadrant];
      pivot.add(holder);

      parts.flowPackets.push({
        sprite: glow,
        glowMaterial: glow.material as THREE.SpriteMaterial,
        curve,
        duration: lane.duration,
        offset: lane.offset + (side === "left" ? 0.17 : 0),
        reverse: lane.reverse,
        laneSide: side,
      });
    }
  }
}

/* ==========================================================
   躯干、触角（不随翼转）
   ========================================================== */

const BODY_ORIGIN: Pt = [CENTER_X, 450];

function buildBody(resolution: THREE.Vector2, parts: ButterflyParts): THREE.Group {
  const group = new THREE.Group();
  const [cx, cy] = toWorld(BODY_ORIGIN[0], BODY_ORIGIN[1]);
  group.position.set(cx, cy, 0);

  const add = (
    polys: Polyline[],
    widthPx: number,
    color: THREE.ColorRepresentation,
    opacity: number,
    dashed: [number, number] | null = null,
  ) => {
    const material = register(parts, makeFatMaterial(widthPx, color, opacity, resolution), null, "body", opacity);
    const positions = dashed
      ? localPairs(dashPairs(polys, dashed[0], dashed[1]), BODY_ORIGIN)
      : localPolys(polys, BODY_ORIGIN);
    group.add(fatSegments(positions, material, parts));
  };

  const outline = parsePath(BODY_OUTLINE);
  /* .body-glow 11px #1d4ed8 α.16 → .body-line 1.1px #a0e5ff α.68 */
  add(outline, 11, "#1d4ed8", 0.16);
  add(outline, 1.1, "#a0e5ff", 0.68);
  add(parsePath(BODY_INNER), 1.1, "#a0e5ff", 0.68);
  add(parsePath(BODY_SPINE), 0.6, "#a0e5ff", 0.3);
  add(parsePath(BODY_RIBS), 0.6, "#7dd3fc", 0.28);
  add([circlePoly(HEAD.cx, HEAD.cy, HEAD.r)], 0.9, "#c8f8ff", 0.7);

  const dot = sprite(parts, flowDotTexture(parts), "#d8fbff", 0.9, HEAD_DOT.r * 3);
  const [dx, dy] = offset(HEAD_DOT.cx - BODY_ORIGIN[0], HEAD_DOT.cy - BODY_ORIGIN[1]);
  dot.position.set(dx, dy, 0);
  group.add(dot);

  return group;
}

/**
 * 触角：旧 CSS 用两层 translate 造出一个绕 (713,445)/(727,445) 摆动的支点，
 * 这里直接把它做成 pivot 组，摆动由 animator 写 rotation.z。
 */
function buildAntennae(resolution: THREE.Vector2, parts: ButterflyParts) {
  const groups: Record<WingSide, THREE.Group> = { left: new THREE.Group(), right: new THREE.Group() };

  ANTENNA.forEach((spec) => {
    const side: WingSide = spec.hinge[0] < CENTER_X ? "left" : "right";
    const pivot = new THREE.Group();
    const [hx, hy] = toWorld(spec.hinge[0], spec.hinge[1]);
    pivot.position.set(hx, hy, 0);

    const material = register(
      parts,
      makeFatMaterial(0.95, "#a0e5ff", 0.7, resolution),
      side,
      "body",
      0.7,
    );
    pivot.add(fatSegments(localPairs(polylinePairs(parsePath(spec.d)), spec.hinge), material, parts));

    const tip = sprite(parts, flowDotTexture(parts), "#d8fbff", 0.85, 9);
    const [tx, ty] = offset(spec.tip[0] - spec.hinge[0], spec.tip[1] - spec.hinge[1]);
    tip.position.set(tx, ty, 0);
    pivot.add(tip);

    groups[side].add(pivot);
  });

  return groups;
}

/* ==========================================================
   中心能量核
   ========================================================== */

function buildCore(resolution: THREE.Vector2, parts: ButterflyParts) {
  const root = new THREE.Group();
  const [cx, cy] = toWorld(CORE.cx, CORE.cy);
  root.position.set(cx, cy, 0);
  const origin: Pt = [CORE.cx, CORE.cy];

  const glowTexture = createCoreGlow();
  const orbTexture = createCoreOrb();
  const beamTexture = createBeam();
  parts.disposables.push(glowTexture, orbTexture, beamTexture);

  /* .core-aura r=140，α = glow × 0.95，7s 缩放脉冲 */
  const aura = sprite(parts, glowTexture, "#ffffff", 0.95, CORE.auraR * 2);
  root.add(aura);

  /* 四条 core-beam：细长加色平面（旧代码是 <ellipse rx ry rotate>） */
  for (const beam of CORE.beams) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    parts.disposables.push(geometry);
    const material = new THREE.MeshBasicMaterial({
      map: beamTexture,
      transparent: true,
      opacity: beam.soft ? 0.34 : 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    parts.disposables.push(material);
    parts.brightness.push({ side: null, layer: "core", material, base: beam.soft ? 0.34 : 0.85 });
    const plane = new THREE.Mesh(geometry, material);
    plane.scale.set(toWorldSize(beam.halfLength * 2), toWorldSize(Math.max(beam.thickness, 1.4)), 1);
    plane.rotation.z = (-beam.rotation * Math.PI) / 180;
    plane.renderOrder = 1;
    root.add(plane);
  }

  /* .core-pulse：三圈环 + orb + glint，整体 scale 脉冲 5.4s */
  const pulse = new THREE.Group();
  root.add(pulse);

  const ringSpecs = [
    { r: CORE.rings[0], width: 0.9, color: "#a0ebff", opacity: 0.58 * 0.9, dashed: [2, 6] as [number, number] },
    { r: CORE.rings[1], width: 0.9, color: "#a0ebff", opacity: 0.58, dashed: null },
    { r: CORE.rings[2], width: 0.7, color: "#ecfeff", opacity: 0.72, dashed: null },
  ];
  let outerRing: FatMaterial | null = null;
  ringSpecs.forEach((spec, index) => {
    const material = makeFatMaterial(spec.width, spec.color, spec.opacity, resolution);
    register(parts, material, null, "core", spec.opacity);
    const polys = [circlePoly(0, 0, spec.r)];
    const positions = spec.dashed
      ? localPairs(dashPairs(polys, spec.dashed[0], spec.dashed[1]), [0, 0])
      : localPolys(polys, [0, 0]);
    /* 这里的多边形已经是相对圆心的坐标，localPairs 只是做单位换算 */
    const mesh = fatSegments(positions, material, parts);
    pulse.add(mesh);
    if (index === 0) outerRing = material;
  });

  /* 旧 SVG 的 orb 就是 r=18 的实心小球，光晕由外面的 core-aura 负责；
     这里如果按 2.6 倍铺，白心会把整颗核糊成一团，反而丢了层次。 */
  const orb = sprite(parts, orbTexture, "#ffffff", 1, CORE.orbR * 2);
  orb.name = "legacyOrb";
  pulse.add(orb);

  const glint = sprite(parts, glowTexture, "#ffffff", 0.9, CORE.glint.r * 3);
  const [gx, gy] = offset(CORE.glint.dx, CORE.glint.dy);
  glint.position.set(gx, gy, 0);
  pulse.add(glint);

  /* .core-rays：坐标本身带圆心，减掉后挂在 root（root 已经在圆心了） */
  const rays = parsePaths(CORE.rays).map((poly) => poly.map(([x, y]) => [x - CORE.cx, y - CORE.cy] as Pt));
  const raysMaterial = makeFatMaterial(0.85, "#c8f6ff", 0.55, resolution);
  register(parts, raysMaterial, null, "core", 0.55);
  const raysPositions: number[] = [];
  for (const [a, b] of polylinePairs(rays)) {
    const [ax, ay] = offset(a[0], a[1]);
    const [bx, by] = offset(b[0], b[1]);
    raysPositions.push(ax, ay, 0, bx, by, 0);
  }
  pulse.add(fatSegments(raysPositions, raysMaterial, parts));

  return { root, pulse, aura, outerRing: outerRing as unknown as FatMaterial };
}

/* ==========================================================
   对外入口
   ========================================================== */

export function buildEcoButterfly(resolution: THREE.Vector2): ButterflyParts {
  const root = new THREE.Group();

  const parts: ButterflyParts = {
    mode: "eco",
    root,
    wings: {} as Record<WingQuadrant, THREE.Group>,
    antennae: { left: new THREE.Group(), right: new THREE.Group() },
    coreRoot: new THREE.Group(),
    corePulse: new THREE.Group(),
    coreAura: new THREE.Sprite(),
    coreOuterRing: null as unknown as FatMaterial,
    flowPackets: [],
    brightness: [],
    disposables: [],
    lineMaterials: [],
    coreRings: [],
  };

  parts.wings = {
    rightTop: buildWing("fore", "right", resolution, parts),
    leftTop: buildWing("fore", "left", resolution, parts),
    rightBottom: buildWing("hind", "right", resolution, parts),
    leftBottom: buildWing("hind", "left", resolution, parts),
  };
  for (const wing of Object.values(parts.wings)) root.add(wing);

  buildFlowPackets(parts, resolution);

  root.add(buildBody(resolution, parts));

  parts.antennae = buildAntennae(resolution, parts);
  root.add(parts.antennae.left, parts.antennae.right);

  const core = buildCore(resolution, parts);
  parts.coreRoot = core.root;
  parts.corePulse = core.pulse;
  parts.coreAura = core.aura;
  parts.coreOuterRing = core.outerRing;
  root.add(core.root);

  return parts;
}
