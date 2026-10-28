/* 四枚翼上节点：三层嵌套「模块接口」环 + 中心宝珠。
 *
 * 三条必须守住的规则（规范 §节点环）：
 *  1) 环**不随翅膀呼吸**。所以刻意不注册进 parts.brightness —— 翼折叠、conduct、
 *     hover 提亮那些乘子一个都吃不到，只有本模块的状态机能改它的 α。
 *     挂在翼 pivot 下只让它跟着折叠产生空间位移（读起来才像"贴在翼面上"），
 *     形状与亮度恒定。
 *  2) hover 是**分段展开**而不是整体渐亮：外/内两层 0.2s 提到 α1.0，
 *     展开环 0.3s 到 α0.3，宝珠 0.4s 点亮。整段 0.45s，退出按 0.35s 原路收回。
 *  3) 安静模式**一帧硬锁**：α 直接落到静态线稿值、转速归零、展开环隐藏，不做过渡。
 *
 * 两档共用同一套环，而且**始终挂在所属翼的 pivot 下**：热区、环、光路终点同属一个变换，
 * 折叠时一起动，投影边界=视觉边界=命中边界。环心相对 DOM 锚点最多漂 ~3 设计像素
 * （12° 折叠 + 0.18 前凸的透视放大），相对 40 像素级的按钮命中区完全可忽略。
 */
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

import {
  WING_SPEC,
  makeFatMaterial,
  offset,
  sprite,
  type ButterflyParts,
  type FatMaterial,
  type WingQuadrant,
} from "./butterfly-scene";
import { circlePoly, dashPairs, polylinePairs, type Pt, type Polyline } from "./wing-geometry";
import { MODULE_NODES, type ModuleNode, type NodeId } from "../nodes";
import { DESIGN_W, fractionToDesignPx } from "./design-space";
import { createCoreOrb } from "./glow-texture";

/** 直径比例 1.00 : 0.80 : 0.58，宝珠 0.15（单位 = 设计像素半径） */
export const RING_RADIUS = { outer: 40, mid: 32, inner: 23.2, pearl: 6 } as const;
/** hover 时向外展开的第 2 层 */
export const RING_EXPAND_RADIUS = RING_RADIUS.outer * 1.12;
/** 不可见热区半径：外环 ×1.15。不取"宝珠 ×1.5"—— 宝珠只有 6 像素，根本不可点 */
export const HOTZONE_RADIUS = RING_RADIUS.outer * 1.15;

/** 环平面绕 X 轴后倾一点：相机有 6° 俯角，这样环面接近正对视线又不至于糊成一条线 */
const RING_TILT_X = -0.14;
/** 旗舰档里贴在脉络前方一点，和光路共面（light-path 的 PATH_Z 同值） */
const RING_Z = 0.18;

const IDLE_ALPHA = { outer: 0.8, mid: 0.45, inner: 0.9, pearl: 0.7 };
const QUIET_ALPHA = { outer: 0.5, mid: 0.25, inner: 0.5, pearl: 0.35 };
const HOVER_ALPHA = { mid: 0.62, pearl: 0.9 };
const ACTIVE_PEARL_ALPHA = 0.95;
/** 展开环峰值很低：它是"有人在叫这个模块"的提示，不是新的主体 */
const EXPAND_ALPHA = 0.3;
/** 焦点落在某一枚节点时，其余三环压到 0.45× */
const DIM_OTHERS = 0.45;

const MID_SPIN_IDLE = 0.11;
const MID_SPIN_HOVER = 0.04;
const OUTER_SPIN = 0.02;
/** 中层扫描环的虚线节拍（设计像素） */
const MID_DASH: [number, number] = [6, 10];

const HOVER_IN = 0.45;
const HOVER_OUT = 0.35;
const DIM_IN = 0.3;
const FLASH_DURATION = 0.35;
const PEARL_PULSE_PERIOD = 1.6;

/** 每层在 0.45s 时间轴上占的秒数窗口 */
const HOVER_WINDOWS = {
  outer: [0, 0.2],
  expand: [0.08, 0.3],
  pearl: [0.18, 0.4],
} as const;

const NODE_WING: Record<NodeId, "fore" | "hind"> = {
  problem: "fore",
  knowledge: "fore",
  cases: "hind",
  sandbox: "hind",
};

type NodePlacement = {
  quadrant: WingQuadrant;
  /** 右翼坐标系下的设计像素：左节点先翻回右侧，剩下的镜像交给 pivot 的 scale.x=-1 */
  design: Pt;
  hinge: Pt;
};

function nodePlacement(node: ModuleNode): NodePlacement {
  const kind = NODE_WING[node.id];
  const [px, py] = fractionToDesignPx(node.x, node.y);
  const design: Pt = node.side === "left" ? [DESIGN_W - px, py] : [px, py];
  return {
    quadrant: `${node.side}${kind === "fore" ? "Top" : "Bottom"}` as WingQuadrant,
    design,
    hinge: WING_SPEC[kind].hinge,
  };
}

/** 节点在所属翼 pivot 局部坐标里的位置（世界单位，z=0）—— 光路的终点就用它 */
export function nodeLocalPosition(node: ModuleNode): THREE.Vector3 {
  const { design, hinge } = nodePlacement(node);
  const [x, y] = offset(design[0] - hinge[0], design[1] - hinge[1]);
  return new THREE.Vector3(x, y, 0);
}

export type NodeRings = {
  setHover(id: NodeId | null): void;
  setActive(id: NodeId | null): void;
  setQuiet(quiet: boolean): void;
  /** ambient = 允许环境动效（flowOn 且非安静）。hover/闪光始终推进，停帧页也要跟手 */
  update(dt: number, ambient: boolean): void;
  /** 还有过渡在跑：停帧分支靠它决定要不要继续补帧 */
  readonly busy: boolean;
  /** 环心（= 宝珠）的世界坐标，热区判定、标签投影、光路终点共用 */
  worldPosition(id: NodeId, out: THREE.Vector3): THREE.Vector3 | null;
  inspect(id: NodeId): Record<string, unknown> | null;
};

type RingUnit = {
  node: ModuleNode;
  anchor: THREE.Group;
  outer: LineSegments2;
  mid: LineSegments2;
  expand: LineSegments2;
  inner: LineSegments2;
  pearl: THREE.Sprite;
  pearlBaseScale: number;
  mats: {
    outer: FatMaterial;
    mid: FatMaterial;
    expand: FatMaterial;
    inner: FatMaterial;
    pearl: THREE.SpriteMaterial;
  };
  hover: number;
  dim: number;
  midAngle: number;
  midSpeed: number;
  outerAngle: number;
  flash: number;
  animating: boolean;
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** 窗口内用 easeOutCubic：起步快、收尾轻，读起来才"克制" */
function windowValue(elapsed: number, [from, to]: readonly [number, number]): number {
  const t = clamp01((elapsed - from) / (to - from || 1));
  return 1 - (1 - t) * (1 - t) * (1 - t);
}

/** 圆心在原点的环：设计像素半径 → 相对锚点的世界坐标线段 */
function ringGeometry(
  parts: ButterflyParts,
  pairs: [Pt, Pt][],
): LineSegmentsGeometry {
  const positions: number[] = [];
  for (const [a, b] of pairs) {
    const [ax, ay] = offset(a[0], a[1]);
    const [bx, by] = offset(b[0], b[1]);
    positions.push(ax, ay, 0, bx, by, 0);
  }
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  parts.disposables.push(geometry);
  return geometry;
}

function ringLine(
  parts: ButterflyParts,
  radius: number,
  material: FatMaterial,
  dash: [number, number] | null,
): LineSegments2 {
  const polys: Polyline[] = [circlePoly(0, 0, radius)];
  const line = new LineSegments2(
    ringGeometry(parts, dash ? dashPairs(polys, dash[0], dash[1]) : polylinePairs(polys)),
    material,
  );
  line.renderOrder = 3;
  line.frustumCulled = false;
  return line;
}

/**
 * 环的材质只登记进 disposables / lineMaterials（后者是 resize 更新 resolution 的必经之路），
 * 绝不进 brightness —— 见文件头规则 1。
 */
function ringMaterial(
  parts: ButterflyParts,
  widthPx: number,
  color: string,
  opacity: number,
  resolution: THREE.Vector2,
): FatMaterial {
  const material = makeFatMaterial(widthPx, color, opacity, resolution);
  parts.disposables.push(material);
  parts.lineMaterials.push(material);
  return material;
}

export function createNodeRings(
  parts: ButterflyParts,
  resolution: THREE.Vector2,
): NodeRings {
  const pearlTexture = createCoreOrb();
  parts.disposables.push(pearlTexture);

  const units: RingUnit[] = MODULE_NODES.map((node) => {
    const placement = nodePlacement(node);
    const anchor = new THREE.Group();
    anchor.rotation.x = RING_TILT_X;

    const mats = {
      outer: ringMaterial(parts, 1.2, "#7dd3fc", IDLE_ALPHA.outer, resolution),
      mid: ringMaterial(parts, 1, "#38bdf8", IDLE_ALPHA.mid, resolution),
      expand: ringMaterial(parts, 0.7, "#a5f3fc", 0, resolution),
      inner: ringMaterial(parts, 1.8, "#d8fbff", IDLE_ALPHA.inner, resolution),
      pearl: null as unknown as THREE.SpriteMaterial,
    };

    const outer = ringLine(parts, RING_RADIUS.outer, mats.outer, null);
    const mid = ringLine(parts, RING_RADIUS.mid, mats.mid, MID_DASH);
    const expand = ringLine(parts, RING_EXPAND_RADIUS, mats.expand, null);
    const inner = ringLine(parts, RING_RADIUS.inner, mats.inner, null);
    expand.visible = false;

    const pearl = sprite(parts, pearlTexture, "#e8feff", IDLE_ALPHA.pearl, RING_RADIUS.pearl * 2);
    pearl.renderOrder = 4;
    mats.pearl = pearl.material as THREE.SpriteMaterial;

    anchor.add(outer, mid, expand, inner, pearl);
    /* 挂在所属翼的 pivot 下：折叠、推镜都跟着走，光路终点与热区球心才会始终重合 */
    const local = nodeLocalPosition(node);
    anchor.position.set(local.x, local.y, RING_Z);
    parts.wings[placement.quadrant].add(anchor);

    return {
      node,
      anchor,
      outer,
      mid,
      expand,
      inner,
      pearl,
      pearlBaseScale: pearl.scale.x,
      mats,
      hover: 0,
      dim: 1,
      midAngle: 0,
      midSpeed: MID_SPIN_IDLE,
      outerAngle: 0,
      flash: 0,
      animating: false,
    };
  });

  let hoveredId: NodeId | null = null;
  let activeId: NodeId | null = null;
  let quiet = false;
  let pulseClock = 0;
  let busyValue = false;

  return {
    setHover(id) {
      hoveredId = id;
    },

    setActive(id) {
      if (id === activeId) return;
      activeId = id;
      /* 只在"刚刚锁上"的那一次爆闪，保持期间不再重复触发 */
      if (id) {
        const unit = units.find((item) => item.node.id === id);
        if (unit) unit.flash = FLASH_DURATION;
      }
    },

    setQuiet(value) {
      quiet = value;
    },

    update(dt, ambient) {
      if (ambient && !quiet) pulseClock += dt;
      busyValue = false;

      for (const unit of units) {
        const isHovered = hoveredId === unit.node.id;
        const isActive = activeId === unit.node.id;

        /* -- hover 进度：点击即锁止（snap），其余按秒线性推进 -- */
        let hoverTarget: number;
        if (isActive) {
          hoverTarget = 1;
          unit.hover = 1;
        } else {
          hoverTarget = isHovered ? 1 : 0;
          const delta = hoverTarget - unit.hover;
          /* 走到目标就停住。用 (target > current ? up : down) 判定方向的话，
             到达 1.0 那一帧 1 > 1 为假会反向退一步，进度就在 0.71/0.94/1 之间来回跳。 */
          const magnitude = Math.min(Math.abs(delta), dt / (delta > 0 ? HOVER_IN : HOVER_OUT));
          unit.hover += Math.sign(delta) * magnitude;
        }
        const elapsed = unit.hover * HOVER_IN;
        const wOuter = windowValue(elapsed, HOVER_WINDOWS.outer);
        const wExpand = windowValue(elapsed, HOVER_WINDOWS.expand);
        const wPearl = windowValue(elapsed, HOVER_WINDOWS.pearl);

        /* -- 其余节点的压暗系数 -- */
        const focused = hoveredId !== null || activeId !== null;
        const dimTarget = focused && !isHovered && !isActive ? DIM_OTHERS : 1;
        unit.dim += (dimTarget - unit.dim) * Math.min(1, dt / DIM_IN);

        /* -- 自转：安静直接归零，锁止/停帧冻在当前角度 -- */
        if (quiet) {
          unit.midAngle = 0;
          unit.outerAngle = 0;
          unit.midSpeed = 0;
        } else if (ambient && !isActive) {
          unit.midSpeed = lerp(MID_SPIN_IDLE, MID_SPIN_HOVER, wOuter);
          unit.midAngle += unit.midSpeed * dt;
          unit.outerAngle += OUTER_SPIN * dt;
        } else {
          unit.midSpeed = 0;
        }
        unit.outer.rotation.z = unit.outerAngle;
        unit.mid.rotation.z = unit.midAngle;

        /* -- 逐层 α -- */
        const base = quiet ? QUIET_ALPHA : IDLE_ALPHA;
        unit.mats.outer.opacity = lerp(base.outer, 1, wOuter) * unit.dim;
        unit.mats.inner.opacity = lerp(base.inner, 1, wOuter) * unit.dim;
        unit.mats.mid.opacity = lerp(base.mid, HOVER_ALPHA.mid, wExpand) * unit.dim;
        unit.mats.expand.opacity = EXPAND_ALPHA * wExpand;

        unit.expand.visible = !quiet && wExpand > 0.002;
        unit.expand.scale.setScalar(lerp(0.94, 1, wExpand));

        if (unit.flash > 0) unit.flash = Math.max(0, unit.flash - dt);
        /* 半周期正弦 = 一次干净的爆闪：0 → 峰 → 0，不吃额外状态 */
        const flashK = unit.flash > 0 ? Math.sin(Math.PI * (1 - unit.flash / FLASH_DURATION)) : 0;
        unit.mats.pearl.opacity = Math.min(1, lerp(base.pearl, isActive ? ACTIVE_PEARL_ALPHA : HOVER_ALPHA.pearl, wPearl) + 0.35 * flashK);

        const pulse = 1 + 0.06 * wPearl * Math.sin((pulseClock / PEARL_PULSE_PERIOD) * Math.PI * 2);
        unit.pearl.scale.setScalar(unit.pearlBaseScale * (1 + 0.12 * wPearl + 0.9 * flashK) * pulse);

        if (
          unit.hover !== hoverTarget ||
          unit.flash > 0 ||
          Math.abs(unit.dim - dimTarget) > 1e-3
        ) {
          unit.animating = true;
          busyValue = true;
        } else {
          unit.animating = false;
        }
      }
    },

    get busy() {
      return busyValue;
    },

    worldPosition(id, out) {
      const unit = units.find((item) => item.node.id === id);
      return unit ? unit.anchor.getWorldPosition(out) : null;
    },

    inspect(id) {
      const unit = units.find((item) => item.node.id === id);
      if (!unit) return null;
      const round = (v: number) => Number(v.toFixed(3));
      const world = unit.anchor.getWorldPosition(new THREE.Vector3());
      return {
        hover: round(unit.hover),
        dim: round(unit.dim),
        outer: round(unit.mats.outer.opacity),
        mid: round(unit.mats.mid.opacity),
        inner: round(unit.mats.inner.opacity),
        expand: round(unit.mats.expand.opacity),
        expandVisible: unit.expand.visible,
        pearl: round(unit.mats.pearl.opacity),
        pearlScale: round(unit.pearl.scale.x),
        midSpeed: round(unit.midSpeed),
        midAngle: round(unit.midAngle),
        /** 给「光路终点必须落在宝珠上」这类断言用 */
        world: world.toArray().map(round),
      };
    },
  };
}
