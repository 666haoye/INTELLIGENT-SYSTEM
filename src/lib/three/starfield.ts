/* 深空星场：一个 THREE.Points、一个 draw call、一片「跟着视锥走」的天空。
 *
 * 参数事实源是 ANIMATION_SPEC.md §5b-2，这里只解释「为什么是这个值」。
 * 只碰 three，不碰 React / DOM —— 与 src/lib/three/ 其余模块同一分层。
 */
import * as THREE from "three";

import { SPACE_CAM_Z, SPACE_TAN_HALF, gaussian, mulberry32, pointSizeScale, type SpaceView } from "./deep-space";

/** 固定种子 ⇒ 每次刷新是同一片天空。验收要断言星点尺寸分布，"看着差不多"不算。 */
export const STAR_SEED = 20261030;

/* ── 空间 ───────────────────────────────────────────────── */

const R_IN = 90;
const R_THICKNESS = 170;
/** 前向 cap 的余量。自转轴与视线夹 31°，所以 cap 中心每转 1° 只偏移 sin31°=0.51°，
 *  0.24°/s × 0.51 → 耗尽这 25° 要 202 分钟，远超单次会话，安静档还会冻住。 */
const CAP_MARGIN = (25 * Math.PI) / 180;

/* ── 运动：判据是「任何星点每帧位移 ≤ 0.1 CSS 像素」 ─────────
 * 点精灵没有运动模糊，超过这个速度就读成"颗粒在爬"而不是"天空在转"。
 * 换算基准：桌面 1440px 宽 / 水平 fov 67° → 21.5 px/度 → 0.086 px/帧。
 */
const SPIN_PERIOD = 1500;
/** 绕近竖直轴转 = 纯水平位移，读成"pan"；绕近视轴转 = 慢速天球旋涡，读成"星轨"。
 *  31° 是两者的混合，且旋极落在相机身后 ⇒ 画面里没有静止点。 */
const SPIN_AXIS = new THREE.Vector3(0.42, 0.3, 0.86).normalize();

/** 幅度从直觉的 1.6 压到 0.95：蝴蝶在另一张画布上不动，两层错动超过 0.3px/s 就会晕。
 *  137 与 89 互质 ⇒ 李萨如 12193s 内不重复，不会有"循环感"。 */
const DRIFT_X_AMPLITUDE = 0.95;
const DRIFT_X_PERIOD = 137;
const DRIFT_Y_AMPLITUDE = 0.62;
const DRIFT_Y_PERIOD = 89;
/** 两轴相位错开，否则 t=0 落在李萨如曲线的角上 */
const DRIFT_PHASE = 0.7;

/* ── 银河带：只做密度 + 雾化偏置，不做亮带 ───────────────────
 * 刻意"更大更暗"（size ×1.4、gain ×0.60）→ 读成未分辨的雾，而不是一条人造条纹。
 * 法向的 z 分量决定带离屏幕中心多远：arcsin(0.243) ≈ 14°，落在竖直半视场 22.5° 内
 * 但不压着中心，于是带子斜穿画面上部。大圆包含 (0.707,0.707,0) ⇒ 屏幕上是
 * 左下→右上的斜带，比水平带自然。 */
const BAND_RATIO = 0.34;
const BAND_NORMAL = new THREE.Vector3(0.62, -0.62, -0.22).normalize();
/** 横向散布用正态而不是均匀：均匀分布会把带的两侧切成硬线 */
const BAND_SIGMA = 0.16;
const BAND_CLAMP = 0.6;
const BAND_RETRIES = 4;
const BAND_SIZE_MUL = 1.4;
const BAND_GAIN_MUL = 0.6;

/* ── 逐星分布 ───────────────────────────────────────────── */

const SIZE_MIN = 0.16;
const SIZE_SPAN = 0.72;
/** 真实星等分布（多小少大），但指数不能太陡：取 3 时实测 54% 的星掉到 1 设备像素
 *  下限、被钉成一模一样大的针尖，"大小不一"就只剩尾巴上那 46% 在兑现。
 *  2.2 是把 floored 压到三分之一上下的拐点。线性又会"大星太多"，看着像贴纸。 */
const SIZE_POWER = 2.2;
const GAIN_MIN = 0.26;
const GAIN_SPAN = 0.74;
const GAIN_POWER = 1.5;
/** 色温三段插值的分界。rand^1.8 让 P(tint<0.55)=0.717 ⇒ 白:淡蓝 ≈ 72:28 */
const TINT_SPLIT = 0.55;
const TINT_POWER = 1.8;
/** 闪烁振幅只有 ±10%、周期 7.4~25.1s。1~3px 的点做大幅度调制读成噪点/坏点，不是闪烁。 */
const TWINKLE_AMPLITUDE = 0.1;
const TWINKLE_RATE_MIN = 0.25;
const TWINKLE_RATE_SPAN = 0.6;

const POINT_SIZE_MIN = 1;
/** 上限按 **CSS 像素** 计，不是设备像素：星点的物理大小必须与 dpr 无关，
 *  否则高分屏上同样的星星反而画得更小。下限留在 1 设备像素（再小就采不到了）。
 *  实测超过 ~5 CSS px 的点精灵在高斯衰减下会读成"漂浮的模糊圆斑"而不是亮星，
 *  这正是要避免的（旧穹顶贴图就是因为同样的问题被弃用）。 */
const POINT_SIZE_MAX_CSS = 6;

/* 色值直接写 sRGB 分量，不进 THREE.Color：r186 默认 ColorManagement.enabled，
 * new THREE.Color("#e5f1ff") 会 sRGB→Linear，而自定义 ShaderMaterial 不会自动补回
 * 输出编码 ⇒ 星色比色值更暗且过饱和。写进帧缓冲即所见，加法混合也和 2D 光轨的
 * lighter 同一观感。 */
const STAR_A = new THREE.Vector3(1.0, 0.9922, 0.9765); // #fffdf9 近中性白
const STAR_B = new THREE.Vector3(0.898, 0.9451, 1.0); // #e5f1ff 冷白
const STAR_C = new THREE.Vector3(0.7137, 0.8235, 0.9882); // #b6d2fc 极淡蓝

const VERT = /* glsl */ `
  uniform float uScale;
  uniform float uDpr;
  uniform float uTime;
  uniform float uTwinkle;
  uniform vec3 uStarA;
  uniform vec3 uStarB;
  uniform vec3 uStarC;
  attribute vec3 aStar;    // x=世界尺寸 y=色温插值 z=亮度增益
  attribute vec2 aTwinkle; // x=相位 y=角速度
  varying vec3 vTint;
  varying float vGain;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);

    /* 分支消除式三段插值：两个 clamp 而不是 if，移动端 GPU 上避免逐点分支 */
    float w1 = clamp(aStar.y / ${TINT_SPLIT.toFixed(4)}, 0.0, 1.0);
    float w2 = clamp((aStar.y - ${TINT_SPLIT.toFixed(4)}) / ${(1 - TINT_SPLIT).toFixed(4)}, 0.0, 1.0);
    vTint = mix(mix(uStarA, uStarB, w1), uStarC, w2);

    vGain = aStar.z * (1.0 + uTwinkle * ${TWINKLE_AMPLITUDE.toFixed(2)} * sin(uTime * aTwinkle.y + aTwinkle.x));

    gl_Position = projectionMatrix * mv;
    /* −mv.z 是视空间深度（相机前为负）。max(1.0, …) 防除零。
       上限乘 uDpr 把「CSS 像素」换算成 gl_PointSize 的单位（设备像素）。 */
    gl_PointSize = clamp(aStar.x * uScale / max(1.0, -mv.z), ${POINT_SIZE_MIN.toFixed(1)}, ${(
      POINT_SIZE_MAX_CSS
    ).toFixed(1)} * uDpr);
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vTint;
  varying float vGain;

  void main() {
    /* 高斯衰减而不是 smoothstep 硬边：gl_PointCoord 在 1 像素点上恒为 (0.5,0.5)
       ⇒ r2=0 ⇒ a=gain，远处最小星不会被衰减吃掉亮度（暗星全靠这条）。
       exp(-7×0.25)=0.17，到精灵边界已经收干净，不需要额外的圆形裁切。 */
    vec2 d = gl_PointCoord - 0.5;
    float a = exp(-dot(d, d) * 7.0) * vGain;
    if (a < 0.004) discard; // 省掉四个角的 overdraw：加法混合下不可见但仍会跑片段
    gl_FragColor = vec4(vTint, a);
  }
`;

export type StarfieldReport = {
  count: number;
  capHalfDeg: number;
  radiusRange: [number, number];
  /** 生成时机位下星点的视空间深度范围 —— 漂移视差就是它撑出来的 */
  depthRange: [number, number];
  /** 星点直径，单位 CSS 像素（与 dpr 无关）：clamped 撞顶、floored 被抬到 1 设备像素 */
  sizeCssPx: { min: number; mean: number; max: number; clamped: number; floored: number };
  bandRatio: number;
  spinAngle: number;
  /** 天球自转真速度（°/s） */
  spinDegPerSecond: number;
  /** cap 中心（视线方向）因自转产生的进动速度，必须远小于 0.24°/s，否则 25° 余量会耗尽 */
  capDriftDegPerSecond: number;
  twinkle: boolean;
  elapsed: number;
  drift: [number, number];
};

export type StarfieldOptions = {
  count: number;
  view: SpaceView;
  camera: THREE.PerspectiveCamera;
  twinkle?: boolean;
  seed?: number;
};

export type Starfield = {
  object: THREE.Points;
  /** 推进自转、闪烁时钟与相机漂移（它直接写 camera.position，那是视差的来源）。
   *  只在"背景活着"时被调用 —— 停调用即冻结，不需要开关。 */
  update(dt: number): void;
  /** 点尺寸基准随 drawingBuffer 高度变，resize 后必须同步 */
  syncView(view: SpaceView): void;
  /** cap 半角跟 aspect 走，转屏要重撒 */
  rebuild(view: SpaceView): void;
  setTwinkle(on: boolean): void;
  inspect(): StarfieldReport;
  dispose(): void;
};

/** 视锥对角半角 + 余量。corner 在角空间是 (tanHalf·aspect, tanHalf)，取模再 atan。 */
function capHalfAngle(aspect: number): number {
  return Math.atan(SPACE_TAN_HALF * Math.sqrt(1 + aspect * aspect)) + CAP_MARGIN;
}

export function createStarfield({
  count,
  view: initialView,
  camera,
  twinkle = true,
  seed = STAR_SEED,
}: StarfieldOptions): Starfield {
  let view = initialView;

  const position = new Float32Array(count * 3);
  const star = new Float32Array(count * 3);
  const twinkleData = new Float32Array(count * 2);
  /** 生成时机位下的视空间深度（= CAM_Z − z）。inspect 用它按当前 uScale 反算像素尺寸。 */
  const depths = new Float32Array(count);
  let bandCount = 0;
  let capHalf = capHalfAngle(view.aspect);

  const geometry = new THREE.BufferGeometry();
  const positionAttr = new THREE.BufferAttribute(position, 3);
  const starAttr = new THREE.BufferAttribute(star, 3);
  const twinkleAttr = new THREE.BufferAttribute(twinkleData, 2);
  geometry.setAttribute("position", positionAttr);
  geometry.setAttribute("aStar", starAttr);
  geometry.setAttribute("aTwinkle", twinkleAttr);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uScale: { value: pointSizeScale(view) },
      uDpr: { value: view.pixelRatio },
      uTime: { value: 0 },
      uTwinkle: { value: twinkle ? 1 : 0 },
      uStarA: { value: STAR_A.clone() },
      uStarB: { value: STAR_B.clone() },
      uStarC: { value: STAR_C.clone() },
    },
    /* 加法混合的透明物写深度会把身后的星抠掉；本层没有任何东西写深度，
       所以 depthTest 只会白跑。层里只有这一个绘制对象，也不需要 renderOrder。 */
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });

  /** uScale 与 uDpr 必须成对更新：前者定物理尺寸，后者把 CSS 像素的封顶换算回设备像素。 */
  const applyView = (next: SpaceView) => {
    material.uniforms.uScale.value = pointSizeScale(next);
    material.uniforms.uDpr.value = next.pixelRatio;
  };
  applyView(view);

  const object = new THREE.Points(geometry, material);
  /* 包围球心在原点、半径 260，而相机在壳内 ⇒ 永远相交，剔除只是白算一次球变换 */
  object.frustumCulled = false;

  /* 带平面的正交基：bandU 与 BAND_NORMAL 垂直且落在 z=0 平面里，
     而 (0.707,0.707,0) 也垂直于 BAND_NORMAL ⇒ 带在屏幕上就是 / 对角方向。 */
  const bandU = new THREE.Vector3().crossVectors(BAND_NORMAL, new THREE.Vector3(0, 0, 1)).normalize();
  const bandV = new THREE.Vector3().crossVectors(BAND_NORMAL, bandU);
  const direction = new THREE.Vector3();

  /** cap 内均匀：对 cos 均匀就是球面均匀，零拒绝采样 */
  const capDirection = (rand: () => number): THREE.Vector3 => {
    const dz = -1 + rand() * (1 - Math.cos(capHalf));
    const r = Math.sqrt(Math.max(0, 1 - dz * dz));
    const phi = rand() * Math.PI * 2;
    return direction.set(r * Math.cos(phi), r * Math.sin(phi), dz);
  };

  /** 带内方向：绕带平面法向转一个正态小角。落在 cap 外就重试，仍失败交给调用方退回均匀 cap。 */
  const bandDirection = (rand: () => number): THREE.Vector3 | null => {
    for (let attempt = 0; attempt < BAND_RETRIES; attempt += 1) {
      const spread = Math.max(-BAND_CLAMP, Math.min(BAND_CLAMP, gaussian(rand) * BAND_SIGMA));
      const along = rand() * Math.PI * 2;
      direction
        .set(0, 0, 0)
        .addScaledVector(bandU, Math.cos(spread) * Math.cos(along))
        .addScaledVector(bandV, Math.cos(spread) * Math.sin(along))
        .addScaledVector(BAND_NORMAL, Math.sin(spread))
        .normalize();
      if (direction.z <= -Math.cos(capHalf)) return direction;
    }
    return null;
  };

  const fill = () => {
    const rand = mulberry32(seed);
    capHalf = capHalfAngle(view.aspect);
    bandCount = 0;

    for (let i = 0; i < count; i += 1) {
      /* inBand 的判断必须先消耗一个随机数，否则同种子下带内/带外的分配会整体错位 */
      const wantsBand = rand() < BAND_RATIO;
      const banded = wantsBand ? bandDirection(rand) !== null : false;
      if (!banded) capDirection(rand);
      if (banded) bandCount += 1;

      /* 半径均匀而不是体积均匀：体积均匀会把 78% 的星推到 R>200，
         近处星太少 → 漂移时没有近/远位移差，视差消失。 */
      const radius = R_IN + R_THICKNESS * rand();
      const x = direction.x * radius;
      const y = direction.y * radius;
      const z = direction.z * radius;

      const size = SIZE_MIN + SIZE_SPAN * rand() ** SIZE_POWER;
      const tint = rand() ** TINT_POWER;
      let gain = GAIN_MIN + GAIN_SPAN * rand() ** GAIN_POWER;
      let finalSize = size;
      if (banded) {
        finalSize = size * BAND_SIZE_MUL;
        gain *= BAND_GAIN_MUL;
      }

      position[i * 3] = x;
      position[i * 3 + 1] = y;
      position[i * 3 + 2] = z;
      star[i * 3] = finalSize;
      star[i * 3 + 1] = tint;
      star[i * 3 + 2] = gain;
      twinkleData[i * 2] = rand() * Math.PI * 2;
      twinkleData[i * 2 + 1] = TWINKLE_RATE_MIN + rand() * TWINKLE_RATE_SPAN;
      depths[i] = SPACE_CAM_Z - z;
    }

    positionAttr.needsUpdate = true;
    starAttr.needsUpdate = true;
    twinkleAttr.needsUpdate = true;
  };

  fill();

  let spinAngle = 0;
  let elapsed = 0;
  let driftX = 0;
  let driftY = 0;

  return {
    object,

    update(dt) {
      elapsed += dt;
      spinAngle += (dt / SPIN_PERIOD) * Math.PI * 2;
      object.quaternion.setFromAxisAngle(SPIN_AXIS, spinAngle);
      material.uniforms.uTime.value = elapsed;

      driftX = DRIFT_X_AMPLITUDE * Math.sin((elapsed / DRIFT_X_PERIOD) * Math.PI * 2);
      driftY = DRIFT_Y_AMPLITUDE * Math.sin((elapsed / DRIFT_Y_PERIOD) * Math.PI * 2 + DRIFT_PHASE);
      camera.position.set(driftX, driftY, SPACE_CAM_Z);
    },

    syncView(next) {
      view = next;
      applyView(next);
    },

    rebuild(next) {
      view = next;
      applyView(next);
      fill();
    },

    setTwinkle(on) {
      /* 只关振幅，不重编译 shader、不留变体 */
      material.uniforms.uTwinkle.value = on ? 1 : 0;
    },

    inspect(): StarfieldReport {
      const uScale = material.uniforms.uScale.value as number;
      const dpr = (material.uniforms.uDpr.value as number) || 1;
      let min = Number.POSITIVE_INFINITY;
      let max = 0;
      let sum = 0;
      let clamped = 0;
      let floor = 0;
      let depthMin = Number.POSITIVE_INFINITY;
      let depthMax = 0;

      for (let i = 0; i < count; i += 1) {
        /* uScale 里含 pixelRatio，所以 raw 是设备像素；除回 dpr 才是与屏幕物理尺寸
           对应的 CSS 像素。报 CSS 像素的好处是断言门限与 dpr、与视口都无关。 */
        const rawCss = (star[i * 3] * uScale) / Math.max(1, depths[i]) / dpr;
        const px = Math.min(POINT_SIZE_MAX_CSS, Math.max(POINT_SIZE_MIN / dpr, rawCss));
        min = Math.min(min, px);
        max = Math.max(max, px);
        sum += px;
        if (rawCss > POINT_SIZE_MAX_CSS) clamped += 1;
        if (rawCss < POINT_SIZE_MIN / dpr) floor += 1;
        depthMin = Math.min(depthMin, depths[i]);
        depthMax = Math.max(depthMax, depths[i]);
      }

      /* cap 中心绕自转轴的进动角速度 = ω·sin(自转轴与视线的夹角)。
         这个值才是 25° 余量够不够用的判据，不是 ω 本身。 */
      const sinToAxis = Math.sqrt(Math.max(0, 1 - SPIN_AXIS.z * SPIN_AXIS.z));

      return {
        count,
        capHalfDeg: Number(((capHalf * 180) / Math.PI).toFixed(2)),
        radiusRange: [R_IN, R_IN + R_THICKNESS],
        depthRange: [Number(depthMin.toFixed(1)), Number(depthMax.toFixed(1))],
        sizeCssPx: {
          min: Number(min.toFixed(2)),
          mean: Number((sum / count).toFixed(2)),
          max: Number(max.toFixed(2)),
          clamped,
          floored: floor,
        },
        bandRatio: Number((bandCount / count).toFixed(3)),
        spinAngle: Number(spinAngle.toFixed(6)),
        spinDegPerSecond: Number((360 / SPIN_PERIOD).toFixed(4)),
        capDriftDegPerSecond: Number(((360 / SPIN_PERIOD) * sinToAxis).toFixed(4)),
        twinkle: material.uniforms.uTwinkle.value === 1,
        elapsed: Number(elapsed.toFixed(3)),
        drift: [Number(driftX.toFixed(4)), Number(driftY.toFixed(4))],
      };
    },

    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
