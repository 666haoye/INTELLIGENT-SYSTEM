/* 深空背景层唯一的「空间与尺度」事实源。
 *
 * 集中在这里的理由是尺度推导只有一份：点尺寸换算要跟相机 fov 与 drawingBuffer
 * 高度一起算，星壳的 cap 半角要跟同一个 tan(fov/2) 一起算 —— 两处各写一遍，
 * 「星点物理尺寸与 dpr 无关」和「整屏都有星」这两条结论就不再互相担保了。
 *
 * 本层为什么不在蝴蝶那个场景里：蝴蝶画布是 .butterfly-center
 * （width:min(112vw,178vh); aspect-ratio:8/5），它不是全屏的 —— 390×844 手机上
 * 只有中间 437×273 一条横带，1440×1080 的 4:3 屏上下各露 36px 黑边；节能档
 * .butterfly-float 还带 CSS translate3d(0,±9px) 浮动。星空做进去会被裁成一条带，
 * 不透明背景会露出一个会上下移动的矩形。而蝴蝶相机的 aspect 必须恒等于
 * DESIGN_W/DESIGN_H（DOM 标签对齐契约，reportAlignment 每次启动都断言它），
 * 也不能靠「把画布改成全屏」解决。所以另开一个 fixed inset 0 的 renderer。
 */
import * as THREE from "three";

/**
 * 视图相关的量集中在一个可变对象里：resize 时组件原地改字段，星空每帧读它。
 * 不作为 update() 参数传，是因为 cap 半角与点尺寸基准只在生成/重排时才需要 aspect，
 * 把它塞进每帧签名只会诱导调用方每帧新建对象。
 */
export type SpaceView = {
  width: number;
  height: number;
  aspect: number;
  pixelRatio: number;
};

/**
 * 45° 竖直视场。刻意不 import design-space 的 CAMERA_FOV：
 * 那个值是 DOM 标签对齐契约的一部分，这里同值只是巧合，
 * 耦合进来会让「调蝴蝶相机」意外改到背景层。
 */
export const SPACE_FOV = 45;
export const SPACE_CAM_Z = 60;
export const SPACE_NEAR = 1;
/** 最远星 = 星壳外半径 260 + 机位 60 = 320，far 留 1.9× 余量 */
export const SPACE_FAR = 620;
export const SPACE_TAN_HALF = Math.tan(((SPACE_FOV / 2) * Math.PI) / 180);

/** 极深邃的暗底：比原来的 #010204 更黑，但 B 通道留 5 避免死黑 */
export const SPACE_BG_COLOR = 0x020205;

export const SPACE_DPR_CAP = 1.5;

/**
 * 背景相机。**不调 lookAt** —— 默认朝向就是 −z。
 * 一旦每帧 lookAt(0,0,0)，漂移会把原点重新拉回画面中心，
 * 平移视差被随之而来的旋转抵消掉，星空就变成一整块刚性平移。
 */
export function createSpaceCamera(aspect: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(SPACE_FOV, aspect, SPACE_NEAR, SPACE_FAR);
  camera.position.set(0, 0, SPACE_CAM_Z);
  return camera;
}

/**
 * gl_PointSize 的换算系数：世界尺寸 → 设备像素。
 * 必须用 drawingBuffer 高度（CSS 高 × pixelRatio），因为 gl_PointSize 的单位
 * 是设备像素而不是 CSS 像素。
 */
export function pointSizeScale(view: SpaceView): number {
  return (view.height * view.pixelRatio) / (2 * SPACE_TAN_HALF);
}

/** Tiny deterministic PRNG —— 固定种子让每次刷新是同一片天空，验收才能断言。 */
export function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller：银河带的横向散布要正态分布，均匀分布会把带边缘切成硬线。 */
export function gaussian(rand: () => number): number {
  const u = Math.max(1e-6, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
