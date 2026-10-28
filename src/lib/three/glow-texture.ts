/* 发光贴图全部用离屏 canvas 现场生成，一张外部图片都不引。
 *
 * 原因：本项目要把整站内联成单个 智教系统首页.html 用 file:// 双击打开
 * （scripts/export-single-html.mjs），既没有网络也没有同目录相对资源，
 * 任何 png/svg 贴图路径都会变成 404。旧的径向渐变是 SVG <radialGradient>，
 * 这里用等价的颜色停靠点画到 canvas 上再包成 CanvasTexture。
 */
import * as THREE from "three";

/** [停靠点 0~1, CSS 颜色（含 alpha）] —— 照抄旧 defs 里的 stop / stop-opacity */
export type ColorStop = [number, string];

const RENDER_SIZE = 128;

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = RENDER_SIZE;
  canvas.height = RENDER_SIZE;
  return canvas;
}

function finish(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * 径向渐变。旧 SVG 的渐变圆心在包围盒里按百分比给（例如 coreOrbGrad 是 40%/35%），
 * 所以这里允许偏心，否则高光位置会和改造前不一样。
 */
export function radialTexture(stops: ColorStop[], focus = { cx: 0.5, cy: 0.5, r: 0.5 }): THREE.CanvasTexture {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  if (!ctx) return finish(canvas);

  const radius = RENDER_SIZE * focus.r;
  const gradient = ctx.createRadialGradient(
    RENDER_SIZE * focus.cx,
    RENDER_SIZE * focus.cy,
    0,
    RENDER_SIZE * focus.cx,
    RENDER_SIZE * focus.cy,
    radius,
  );
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, RENDER_SIZE, RENDER_SIZE);
  return finish(canvas);
}

/** 横向渐变条（旧 core-beam 用的 linearGradient：两端透明、中间最亮） */
export function barTexture(stops: ColorStop[]): THREE.CanvasTexture {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  if (!ctx) return finish(canvas);

  const gradient = ctx.createLinearGradient(0, 0, RENDER_SIZE, 0);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  /* 只画中间一条带，两端留空，贴到细长平面上就是一道有衰减的光束 */
  ctx.fillRect(0, RENDER_SIZE * 0.42, RENDER_SIZE, RENDER_SIZE * 0.16);
  return finish(canvas);
}

/* 以下常量与原 Butterfly.tsx 的 <defs> 一一对应 */

export const CORE_GLOW_STOPS: ColorStop[] = [
  [0, "rgba(216, 251, 255, 0.72)"],
  [0.26, "rgba(56, 189, 248, 0.32)"],
  [0.6, "rgba(29, 78, 216, 0.12)"],
  [1, "rgba(2, 6, 23, 0)"],
];

/**
 * orb 的渐变收尾必须透明：radialTexture 是 fillRect 铺满整张画布的，
 * 渐变半径之外会延续最后一个停靠点的颜色 —— 若那是不透明的 #2563eb，
 * 圆球就会带出四个实心直角，画出来像个圆角方块。
 */
export const CORE_ORB_STOPS: ColorStop[] = [
  [0, "#ffffff"],
  [0.42, "#e8feff"],
  [0.72, "#7dd3fc"],
  [0.9, "rgba(37, 99, 235, 0.9)"],
  [1, "rgba(37, 99, 235, 0)"],
];

export const FLOW_DOT_STOPS: ColorStop[] = [
  [0, "rgba(232, 254, 255, 0.8)"],
  [0.35, "rgba(56, 189, 248, 0.28)"],
  [1, "rgba(29, 78, 216, 0)"],
];

export const CORE_BEAM_STOPS: ColorStop[] = [
  [0, "rgba(56, 189, 248, 0)"],
  [0.28, "rgba(56, 189, 248, 0.24)"],
  [0.5, "rgba(216, 251, 255, 0.8)"],
  [0.72, "rgba(56, 189, 248, 0.24)"],
  [1, "rgba(56, 189, 248, 0)"],
];

export function createCoreGlow(): THREE.CanvasTexture {
  return radialTexture(CORE_GLOW_STOPS);
}

export function createCoreOrb(): THREE.CanvasTexture {
  return radialTexture(CORE_ORB_STOPS, { cx: 0.4, cy: 0.35, r: 0.7 });
}

export function createFlowDot(): THREE.CanvasTexture {
  return radialTexture(FLOW_DOT_STOPS);
}

export function createBeam(): THREE.CanvasTexture {
  return barTexture(CORE_BEAM_STOPS);
}

/**
 * 深空穹顶内壁的发光经纬网格（等距矩形投影，贴到 BackSide 球面上正好是经线/纬线）。
 * 单独开一张非正方形画布：球面 UV 是 2:1，用 128×128 会让网格明显变形。
 */
export function createDomeGrid(): THREE.CanvasTexture {
  const width = 512;
  const height = 256;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  ctx.fillStyle = "#010204";
  ctx.fillRect(0, 0, width, height);

  /* 经线：等距 24 根，靠两极视觉上自然变密 */
  ctx.strokeStyle = "rgba(29, 78, 216, 0.5)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 24; i += 1) {
    const x = (i / 24) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  /* 纬线：中间密、两端疏，模拟发光纬度带 */
  for (let i = 0; i <= 12; i += 1) {
    const y = (i / 12) * height;
    const fade = 0.16 + 0.34 * Math.sin((i / 12) * Math.PI);
    ctx.strokeStyle = `rgba(56, 189, 248, ${fade.toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  /* 不画星点：512×256 的贴图铺到半径 58 的球面上会被放大十几倍，
     一两个像素的圆点渲染出来就是画面里漂浮的模糊方块。方案要的是发光经纬网格。 */
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}
