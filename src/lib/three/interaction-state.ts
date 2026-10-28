/* 交互状态机：把"点击 → 推镜 → 光路 → 转场"和"返回 → 收尾"做成一条有因果的时序。
 *
 * 刻意做成纯逻辑：不碰 three、不碰 DOM，所以时序断言可以在 Node 里直接跑。
 * 组件只负责把每帧的 settled / hidden / hardLock 喂进来，然后照输出执行。
 *
 * 两条硬规则：
 *  1) 光路从 ghost 升 active 的唯一闸门是「相机已稳定」+「推镜时长走完」，
 *     不是定时器 —— 推镜参数怎么调，因果顺序都不会乱。
 *  2) 隐藏标签页 / 停帧时不推进计时、不 emit 转场；否则切回来的瞬间面板会自己弹出来。
 */
import type { NodeId } from "../nodes";

export type Phase = "idle" | "hover" | "locking" | "locked" | "returning";
export type CameraMode = "cruise" | "focus" | "lock" | "return";
export type PathState = "off" | "ghost" | "active" | "dissolving";

export type MachineTimings = {
  /** 点击到"可以点亮光路"的最短推镜时长 */
  push: number;
  /** 光路点亮到开始保持 */
  activate: number;
  /** 保持多久再转场 */
  hold: number;
  /** 返回时拉回时长 */
  pull: number;
  /** 光路溶解 + 粒子回流 */
  dissolve: number;
  /** 翅膀减速到定格的时间 */
  gate: number;
};

export const DEFAULT_TIMINGS: MachineTimings = {
  push: 0.4,
  /* 实测：推镜约 0.5s 达到稳定判据，加上 activate + hold 要落在 1.3s 左右，
     所以这两段比规范给的 0.4 / 0.5 略紧 */
  activate: 0.35,
  hold: 0.35,
  pull: 0.5,
  dissolve: 0.4,
  gate: 0.7,
};

export type MachineOutput = {
  phase: Phase;
  /** 0~1：翼的"油门"，已含缓动 */
  wingGate: number;
  camera: CameraMode;
  path: PathState;
  particles: boolean;
  /** 本帧要开面板（只会为 true 一帧） */
  transition: boolean;
  /** 本帧要立刻把翼摆回正面对称（只会为 true 一帧） */
  snapWings: boolean;
  /** 本帧要重置呼吸相位并重新起振（只会为 true 一帧） */
  restartBreathing: boolean;
};

export type MachineInput = {
  dt: number;
  /** false = 隐藏页 / 停帧：不推进、不 emit */
  ticking: boolean;
  /** 相机是否已经稳定（连续 3 帧位移低于阈值） */
  settled: boolean;
  /** 安静模式 / 静态降级：一切硬锁 */
  hardLock: boolean;
};

export type InteractionMachine = {
  hoverStart(node: NodeId): void;
  hoverEnd(node?: NodeId): void;
  click(node: NodeId): void;
  returnStart(): void;
  /** 深链（AI dock / 知识库跳转）绕开时序直接落位 */
  skip(to: "locked" | "idle"): void;
  update(input: MachineInput): MachineOutput;
  readonly phase: Phase;
  readonly target: NodeId | null;
  readonly wingGate: number;
  readonly path: PathState;
};

export function createInteractionMachine(
  timings: Partial<MachineTimings> = {},
): InteractionMachine {
  const T: MachineTimings = { ...DEFAULT_TIMINGS, ...timings };

  let phase: Phase = "idle";
  let target: NodeId | null = null;
  let phaseTimer = 0;
  let gate = 1;
  let gateTarget = 1;
  let path: PathState = "off";

  const output = (): MachineOutput => ({
    phase,
    wingGate: gate,
    camera:
      phase === "locked" || phase === "locking"
        ? "lock"
        : phase === "returning"
          ? "return"
          : phase === "hover"
            ? "focus"
            : "cruise",
    path,
    particles: path === "active" || path === "dissolving",
    transition: false,
    snapWings: false,
    restartBreathing: false,
  });

  const enter = (next: Phase) => {
    phase = next;
    phaseTimer = 0;
  };

  return {
    hoverStart(node) {
      if (phase === "locking" || phase === "locked" || phase === "returning") return;
      target = node;
      enter("hover");
      path = "ghost";
      gateTarget = 0;
    },

    hoverEnd(node) {
      if (node && target && node !== target) return;
      if (phase !== "hover") return;
      target = null;
      enter("idle");
      path = "off";
      gateTarget = 1;
    },

    click(node) {
      if (phase === "locking" || phase === "returning") return;
      target = node;
      enter("locking");
      path = "ghost";
      /* 规范：点击后立即冻结，不吃缓动 */
      gate = 0;
      gateTarget = 0;
    },

    returnStart() {
      if (phase !== "locked" && phase !== "locking") return;
      enter("returning");
      path = "dissolving";
      gate = 0;
      gateTarget = 0;
    },

    skip(to) {
      if (to === "locked") {
        phase = "locked";
        phaseTimer = 0;
        path = target ? "active" : "off";
        gate = 0;
        gateTarget = 0;
      } else {
        phase = "idle";
        phaseTimer = 0;
        target = null;
        path = "off";
        gateTarget = 1;
      }
    },

    update({ dt, ticking, settled, hardLock }) {
      const out = output();

      if (hardLock) {
        /* 安静模式 / 静态降级：瞬回正面对称、锁死、光路与粒子全关，不做过渡 */
        if (gate !== 0 || path !== "off") out.snapWings = true;
        gate = 0;
        gateTarget = 0;
        path = "off";
        out.wingGate = 0;
        out.path = "off";
        out.particles = false;
        return out;
      }

      if (!ticking) {
        /* 停帧：输出当前状态，但不推进计时、不 emit */
        return out;
      }

      phaseTimer += dt;

      switch (phase) {
        case "hover":
          gateTarget = 0;
          path = "ghost";
          break;

        case "locking": {
          gateTarget = 0;
          if (path === "ghost") {
            /* 硬闸门：推镜时长走完 + 相机稳定，两者都满足才点亮光路 */
            if (phaseTimer >= T.push && settled) {
              path = "active";
              phaseTimer = 0;
            }
          } else if (path === "active") {
            if (phaseTimer >= T.activate + T.hold) {
              out.transition = true;
              enter("locked");
            }
          }
          break;
        }

        case "locked":
          gateTarget = 0;
          if (target) path = "active";
          break;

        case "returning":
          gateTarget = 0;
          if (path === "dissolving" && phaseTimer >= T.pull + T.dissolve) {
            path = "off";
            target = null;
            gateTarget = 1;
            out.restartBreathing = true;
            enter("idle");
          }
          break;

        case "idle":
        default:
          gateTarget = 1;
          if (path !== "off") path = "off";
          break;
      }

      /* 指数缓动：0.7s 内走完约 95%，与帧率无关 */
      const damping = 1 - Math.exp(-dt / (T.gate / 3));
      gate += (gateTarget - gate) * damping;
      /* 指数永远到不了 0，翼相位会一直以极慢速度爬 —— 低于阈值就直接吸附，
         这样 hover 的「定格」是精确的，可被断言，也不会积累成可见漂移。 */
      if (Math.abs(gate - gateTarget) < 1e-3) gate = gateTarget;

      out.phase = phase;
      out.wingGate = gate;
      out.camera =
        phase === "locked" || phase === "locking"
          ? "lock"
          : phase === "returning"
            ? "return"
            : phase === "hover"
              ? "focus"
              : "cruise";
      out.path = path;
      out.particles = path === "active" || path === "dissolving";
      return out;
    },

    get phase() {
      return phase;
    },
    get target() {
      return target;
    },
    get wingGate() {
      return gate;
    },
    get path() {
      return path;
    },
  };
}
