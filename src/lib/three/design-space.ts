/* 设计稿坐标系 → Three.js 世界坐标系的唯一映射。
 *
 * 旧实现是一张 viewBox="0 0 1440 900" 的 SVG，铺满 .butterfly-center
 * （width:min(112vw,178vh); aspect-ratio:8/5，正好 1440:900），并且
 * preserveAspectRatio="xMidYMid meet"。容器长宽比与设计稿完全一致，所以
 * 「设计像素 → 容器百分比」是严格线性的，而 DOM 节点层
 * （WingNode.tsx 用 left = node.x*100%）用的就是同一套百分比。
 * 3D 侧沿用同一个映射，DOM 标签一行都不用改就能和翼根对齐。
 */

export const DESIGN_W = 1440;
export const DESIGN_H = 900;
export const CENTER_X = DESIGN_W / 2;
export const CENTER_Y = DESIGN_H / 2;

/** 世界单位 = 设计像素 / 100 */
export const PX_PER_UNIT = 100;

export const WORLD_HALF_W = CENTER_X / PX_PER_UNIT;
export const WORLD_HALF_H = CENTER_Y / PX_PER_UNIT;

/** 45° 竖直视场。相机距离由它反推，使 z=0 平面的可视高度刚好等于设计稿高度。 */
export const CAMERA_FOV = 45;

/**
 * 整只蝴蝶都在 z=0 平面上，透视投影在该平面退化成纯线性缩放，
 * 因此只要让 z=0 处的可视半高 = WORLD_HALF_H，世界坐标与容器百分比就逐点相等。
 */
export const CAMERA_DISTANCE = WORLD_HALF_H / Math.tan(((CAMERA_FOV / 2) * Math.PI) / 180);

/** 设计像素 → 世界坐标。SVG 的 y 向下，世界 y 向上，故取负。 */
export function toWorld(px: number, py: number, z = 0): [number, number, number] {
  return [(px - CENTER_X) / PX_PER_UNIT, -(py - CENTER_Y) / PX_PER_UNIT, z / PX_PER_UNIT];
}

/** 设计像素长度（线宽、半径、弧长）→ 世界单位长度 */
export function toWorldSize(size: number): number {
  return size / PX_PER_UNIT;
}

/** 节点坐标存的是 0~1 比例（nodes.ts），换算成设计像素 */
export function fractionToDesignPx(fx: number, fy: number): [number, number] {
  return [fx * DESIGN_W, fy * DESIGN_H];
}

/* ==========================================================
   相机（阶段 1.5 收敛版：防晕优先）
   ========================================================== */

/** 初始机位距离，同时是「推镜不能贴脸」的基准 */
export const HOME_DISTANCE = CAMERA_DISTANCE;

const deg = (value: number) => (value * Math.PI) / 180;

/** 巡航周期 30s；摆幅压到几乎静止，保证第一眼是清晰的正面对称构图 */
export const CRUISE_PERIOD = 30;
export const CRUISE_YAW_AMPLITUDE = deg(2);
export const CRUISE_PITCH_AMPLITUDE = deg(1.6);
export const CRUISE_ELEVATION_BASE = deg(6);

/** hover 聚焦 / 点击构图时的半径占比 */
export const FOCUS_RADIUS_RATIO = 0.82;
export const LOCK_RADIUS_RATIO = 0.62;
/**
 * 推镜硬下限：任何参数改动都不得低于初始距离的 40%（规范红线）。
 * 用 Math.max 夹住实际半径，而不是只依赖上面两个比例 —— 比例被改坏也不会贴脸。
 */
export const MIN_RADIUS_RATIO = 0.4;

/**
 * 阻尼时间常数（秒）。0.22 是实测定下来的：0.35 时指数尾巴太长，
 * 相机要 1.1s 才达到稳定判据，点击到转场会拖到 2s。
 */
export const CAMERA_DAMPING = 0.22;
/** 判定「构图已稳定」的位移阈值（世界单位/帧）与连续帧数 */
export const SETTLE_EPSILON = 0.008;
export const SETTLE_FRAMES = 3;
