/* 呼吸式扇动 + 能量核脉冲 + 脉络亮度联动 + 触角摆动 + 翅上光流推进。
 *
 * 时间基准只有一个：组件里累加的 clock。它在 tempo=1.65（安静模式）时走得更慢
 * （见 ButterflyScene.tsx 的 clock += dt / tempo），所以这里所有周期都直接写设计值，
 * tempo 的语义只生效一次，不会到处乘。
 *
 * 参数出处：
 *  - 扇动 ±8° / 5s：方案 §2 + 用户指定
 *  - 核脉冲 5.4s scale 0.93→1.07、aura 7s 0.92→1.06、外环 32s 自转：globals.css:526/550/574
 *  - 触角摆动关键帧：globals.css:492-516
 *  - conduct 1.4s 与各层峰值：globals.css:351-393（wing-conduct / vein-conduct / vein-bright-conduct）
 */
import type { ButterflyParts, BrightnessLayer, WingQuadrant } from "./butterfly-scene";
import type { WingSide } from "../nodes";

/**
 * 四翼同步机械呼吸（阶段 1.5 收敛）：
 *   fold(t) = 12° × (0.5 − 0.5·cos(2π·t/6))
 * t=0 → 0°、t=3s → 12°、t=6s → 0°，cos 形式本身就是 easeInOutSine，天然无回弹。
 * 四翼共用同一个角度值，左翼靠 pivot.scale.x=-1 自动镜像成对称内收。
 * 只向内收、不向外张 —— 视觉上是「能量膜开合」，不是拍翅。
 */
const FOLD_PERIOD = 6;
const FOLD_MAX = (12 * Math.PI) / 180;

/** 与折叠同周期，让核心脉冲和翼呼吸是同一口气（原来是 5.4s，会和 6s 打架） */
const CORE_PULSE_PERIOD = FOLD_PERIOD;
const CORE_AURA_PERIOD = FOLD_PERIOD;
const CORE_RING_SPIN_PERIOD = 32;
/** 穹顶自转：一圈约 10 分钟，只作空间感，不该被意识成「在动」 */
const DOME_PERIOD = 600;

const ANTENNA_PERIOD: Record<WingSide, number> = { left: 9, right: 10.5 };
const ANTENNA_DELAY: Record<WingSide, number> = { left: 0, right: -3.4 };
const ANTENNA_FRAMES: Record<WingSide, Array<[number, number]>> = {
  left: [
    [0, 1.2],
    [0.42, -1.6],
    [0.72, 0.2],
    [1, 1.2],
  ],
  right: [
    [0, -1],
    [0.38, 1.5],
    [0.7, -0.3],
    [1, -1],
  ],
};

const CONDUCT_DURATION = 1.4;
/** 每层的目标 opacity 相对基准值的倍率，峰值时刻照抄 CSS 关键帧 */
const CONDUCT_FRAMES: Record<"wingGlow" | "veinGlow" | "veinBright", Array<[number, number]>> = {
  /* .wing-glows 组基准 0.9 → 1 */
  wingGlow: [
    [0, 1],
    [0.34, 1 / 0.9],
    [1, 1],
  ],
  /* .vein-glow path 0.09 → 0.62 */
  veinGlow: [
    [0, 1],
    [0.3, 0.62 / 0.09],
    [1, 1],
  ],
  /* .vein--bright 0.75 → 1 */
  veinBright: [
    [0, 1],
    [0.3, 1 / 0.75],
    [1, 1],
  ],
};

/** hover 时把该侧 wingGlow / wingLine 的组透明度提到 1（globals.css:295-303） */
const HOVER_LIFT: Partial<Record<BrightnessLayer, number>> = {
  wingGlow: 1 / 0.9,
  wingLine: 1 / 0.96,
  /* 节点视觉已归 3D，hover 提亮是它唯一的反馈入口 */
  socket: 1.5,
};

/** 扇动时脉络亮度联动（方案 §4.2：舒展变亮、收拢变暗） */
const FLAP_LINKED: BrightnessLayer[] = ["wingLine", "wingGlow", "veinGlow", "veinBright"];

const deg2rad = (value: number) => (value * Math.PI) / 180;

/**
 * 与 CSS keyframes「0%/100% 取小值、50% 取大值 + ease-in-out」同形的振荡：
 * t=0 时正好落在 min，半周期到 max。
 */
function osc(min: number, max: number, t: number, period: number): number {
  return min + (max - min) * (0.5 - 0.5 * Math.cos((t / period) * Math.PI * 2));
}

/** 关键帧线性插值，phase 允许超过 1（自动取模） */
function keyframe(phase: number, frames: Array<[number, number]>): number {
  const t = phase - Math.floor(phase);
  for (let i = 1; i < frames.length; i += 1) {
    const [p0, v0] = frames[i - 1];
    const [p1, v1] = frames[i];
    if (t <= p1) {
      const span = p1 - p0 || 1;
      return v0 + ((t - p0) / span) * (v1 - v0);
    }
  }
  return frames[frames.length - 1][1];
}

const QUADRANTS: Record<WingQuadrant, { side: WingSide; hind: boolean }> = {
  leftTop: { side: "left", hind: false },
  rightTop: { side: "right", hind: false },
  leftBottom: { side: "left", hind: true },
  rightBottom: { side: "right", hind: true },
};

export type AnimatorInput = {
  /** 动画总闸：安静 / 静态 / 失焦 / 面板打开时为 false，此时只摆静态姿态 */
  flowOn: boolean;
  /** CSS 的 --glow：1 或 0.55，旧代码里只作用于 core-aura / core-beam */
  glow: number;
  hoveredSide: WingSide | null;
  /** 状态机给的翼油门 0~1：hover 减速、click 冻结、返回后重启都靠它 */
  wingGate: number;
  /** 本帧要立刻把翼摆回正面对称（安静模式 / 返回结束） */
  snapWings?: boolean;
  /** 本帧要重置呼吸相位再起振 */
  restartBreathing?: boolean;
};

export type WingAnimator = {
  apply(clock: number, dt: number, input: AnimatorInput): void;
  /** 光轨命中节点：让该侧翼的脉络亮一波 */
  conduct(side: WingSide, clock: number): void;
};

export function createWingAnimator(parts: ButterflyParts): WingAnimator {
  const conductStart: Record<WingSide, number> = { left: Number.NEGATIVE_INFINITY, right: Number.NEGATIVE_INFINITY };
  const hoverLevel: Record<WingSide, number> = { left: 0, right: 0 };
  const auraBaseScale = parts.coreAura.scale.x;
  const ringMesh = parts.corePulse.children[0];
  /* 翼自己的呼吸相位。由 gate 决定推进速度：gate→0 时相位冻住，翼就定格在当前姿态，
     而不是被"拉回 0°" —— 这是 hover 定格与安静模式硬锁的关键区别。 */
  let wingClock = 0;

  return {
    conduct(side, clock) {
      conductStart[side] = clock;
    },

    apply(clock, dt, input) {
      const active = input.flowOn;
      /* 停帧时把 clock 当作 0：核脉冲/触角取基准姿态 */
      const t = active ? clock : 0;

      /* ---- 0. 翼的呼吸相位：gate 是唯一油门 ---- */
      if (input.snapWings || input.restartBreathing) wingClock = 0;
      if (active) wingClock += dt * Math.max(0, Math.min(1, input.wingGate));

      /* ---- 1. 四翼同步折叠（四翼同一个角度，左翼由 scale.x=-1 自动镜像）---- */
      const foldPhase = (wingClock / FOLD_PERIOD) * Math.PI * 2;
      const fold = FOLD_MAX * (0.5 - 0.5 * Math.cos(foldPhase));
      for (const key of Object.keys(QUADRANTS) as WingQuadrant[]) {
        const wing = parts.wings[key];
        if (!wing) continue;
        /* 只绕 hinge 的竖直轴、只向内收，x/z 保持 0 —— 不做三轴，也不向外张 */
        wing.rotation.set(0, fold, 0);
      }

      /* ---- 2. hover 平滑（旧 CSS 是 transition 480ms×tempo）----
         hover 属于 transition 而不是 animation，`.is-quiet *{animation:none}`
         关不掉它，所以安静模式下依旧提亮，与改造前一致。 */
      const rate = Math.min(1, dt / 0.48);
      for (const side of ["left", "right"] as const) {
        const target = input.hoveredSide === side ? 1 : 0;
        hoverLevel[side] += (target - hoverLevel[side]) * rate;
      }

      /* ---- 3. 亮度联动：内收越深脉络越亮（能量膜被压紧的感觉）---- */
      const foldProgress = fold / FOLD_MAX;
      const flapMul = active ? 0.9 + 0.18 * foldProgress : 1;

      for (const entry of parts.brightness) {
        let multiplier = 1;

        if (entry.side !== null) {
          multiplier *= 1 + hoverLevel[entry.side] * ((HOVER_LIFT[entry.layer] ?? 1) - 1);
          if (active) {
            if (FLAP_LINKED.includes(entry.layer)) multiplier *= flapMul;
            const frames = CONDUCT_FRAMES[entry.layer as keyof typeof CONDUCT_FRAMES];
            if (frames) {
              const elapsed = t - conductStart[entry.side];
              if (elapsed >= 0 && elapsed <= CONDUCT_DURATION) {
                multiplier *= keyframe(elapsed / CONDUCT_DURATION, frames);
              }
            }
          }
        } else if (entry.layer === "core") {
          /* --glow 在旧 CSS 里只作用于 core-aura / core-beam（globals.css:523/540/544） */
          multiplier *= input.glow;
        }

        entry.material.opacity = entry.base * multiplier;
      }

      /* ---- 4. 能量核：0.93~1.07 脉冲、aura 0.92~1.06、外环 32s 自转 ---- */
      parts.corePulse.scale.setScalar(active ? osc(0.93, 1.07, t, CORE_PULSE_PERIOD) : 1);
      parts.coreAura.scale.setScalar(auraBaseScale * (active ? osc(0.92, 1.06, t, CORE_AURA_PERIOD) : 1));
      if (ringMesh) ringMesh.rotation.z = active ? (t / CORE_RING_SPIN_PERIOD) * Math.PI * 2 : 0;

      /* ---- 4b. 旗舰档：三层能量环各自转速、穹顶极慢自转 ---- */
      for (const ring of parts.coreRings) {
        const speed = Number(ring.userData.spin ?? 1);
        const axis = speed === 1 ? "z" : speed === 2 ? "x" : "y";
        ring.rotation[axis] = active ? (t / (18 * speed)) * Math.PI * 2 : 0;
      }
      if (parts.dome) {
        parts.dome.rotation.y = active ? (t / DOME_PERIOD) * Math.PI * 2 : 0;
      }

      /* ---- 5. 触角摆动 ---- */
      for (const side of ["left", "right"] as const) {
        const holder = parts.antennae[side];
        if (!holder) continue;
        const phase = (t + ANTENNA_DELAY[side]) / ANTENNA_PERIOD[side];
        holder.rotation.z = deg2rad(keyframe(phase, ANTENNA_FRAMES[side]));
      }

      /* ---- 6. 翅上光流包 ---- */
      for (const packet of parts.flowPackets) {
        if (!active) {
          packet.glowMaterial.opacity = 0;
          continue;
        }

        const cycle = (t / packet.duration + packet.offset) % 1;
        const progress = packet.reverse ? 1 - cycle : cycle;
        const point = packet.curve.getPointAt(Math.min(1, Math.max(0, progress)));
        packet.sprite.position.copy(point);
        /* 两端淡出，包络与旧实现一致：min(1, edge*8) * 0.95 */
        packet.glowMaterial.opacity = Math.min(1, Math.min(cycle, 1 - cycle) * 8) * 0.95;
      }
    },
  };
}
