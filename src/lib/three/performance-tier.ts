/* 运行时帧率治理：初始档位由环境信号判定（environment.ts），但信号会骗人 ——
 * 一台核数很漂亮、却插着集显或者正被后台任务占满的机器，只有真跑起来才知道掉帧。
 * 所以再加一层实测：连续 90 帧均值低于阈值就降到 eco，且只降不升。
 */
import type { RenderTier } from "../environment";

const WARMUP_SECONDS = 1.5;
/** 迟滞：前 5 秒内的抖动（首次着色器编译、图片解码、面板动画）不作为降级依据 */
const DECIDE_AFTER_SECONDS = 5;
const WINDOW_FRAMES = 90;
const THRESHOLD_FPS = 45;

export type FpsGovernor = {
  sample(dtSeconds: number, visible: boolean): void;
  readonly decided: boolean;
};

export function createFpsGovernor(onDowngrade: (measuredFps: number) => void): FpsGovernor {
  let elapsed = 0;
  let frames = 0;
  let windowSeconds = 0;
  let done = false;

  return {
    get decided() {
      return done;
    },
    sample(dtSeconds, visible) {
      /* 隐藏标签页里 rAF 本来就不跑；切回来时第一帧的 dt 是「离开多久」而不是帧间隔，
         直接喂进来会把均值压成个位数造成误判，所以不可见时整段作废重算。 */
      if (done || !visible) {
        frames = 0;
        windowSeconds = 0;
        return;
      }

      elapsed += dtSeconds;
      if (elapsed < WARMUP_SECONDS) return;

      frames += 1;
      windowSeconds += dtSeconds;
      if (frames < WINDOW_FRAMES) return;

      const fps = frames / windowSeconds;
      frames = 0;
      windowSeconds = 0;

      if (elapsed < DECIDE_AFTER_SECONDS) return;
      if (fps < THRESHOLD_FPS) {
        done = true;
        onDowngrade(fps);
      }
    },
  };
}

/** 只给开发期用：?tier=eco / ?tier=flagship 强制锁档，?fps=20 伪造低帧率验证降级路径 */
export function readTierOverride(): RenderTier | null {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("tier");
  return value === "eco" || value === "flagship" ? value : null;
}

export function readSyntheticFps(): number | null {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") return null;
  const raw = Number(new URLSearchParams(window.location.search).get("fps"));
  return Number.isFinite(raw) && raw > 0 && raw < 240 ? raw : null;
}
