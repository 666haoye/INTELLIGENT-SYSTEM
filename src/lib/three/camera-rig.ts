/* 相机运镜（阶段 1.5 收敛版）：默认近乎静止的正面构图，聚焦靠阻尼推镜，永不贴脸。
 *
 * 三条硬约束：
 *  1) 半径硬下限 0.4×初始距离（规范红线），用 Math.max 夹在每一帧，不依赖调用方自觉。
 *  2) 只用指数阻尼插值（1 - exp(-dt/τ)），与帧率无关；没有线性插值、没有急停急启。
 *  3) 聚焦/点击时偏航与俯仰都归零 —— 镜头只在 z 轴上推，画面不会同时转+推，
 *     这是消除 3D 晕眩最有效的一条。
 */
import * as THREE from "three";
import {
  CAMERA_DAMPING,
  CRUISE_ELEVATION_BASE,
  CRUISE_PERIOD,
  CRUISE_PITCH_AMPLITUDE,
  CRUISE_YAW_AMPLITUDE,
  FOCUS_RADIUS_RATIO,
  HOME_DISTANCE,
  LOCK_RADIUS_RATIO,
  MIN_RADIUS_RATIO,
  SETTLE_EPSILON,
  SETTLE_FRAMES,
} from "./design-space";

export type CameraMode = "cruise" | "focus" | "lock" | "return";

export type CameraRig = {
  update(clock: number, dt: number, mode: CameraMode, focus: THREE.Vector3 | null): void;
  reset(): void;
  /** 连续若干帧位移低于阈值 → 构图已稳定，是「光路必须晚于镜头」的唯一闸门 */
  isSettled(): boolean;
  readonly radius: number;
};

export function createCameraRig(camera: THREE.PerspectiveCamera): CameraRig {
  const home = camera.position.clone();
  const desiredPosition = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();
  const currentLook = new THREE.Vector3(0, 0, 0);
  const previousPosition = new THREE.Vector3().copy(camera.position);

  let radius = HOME_DISTANCE;
  let yaw = 0;
  let elevation = CRUISE_ELEVATION_BASE;
  let stillFrames = 0;
  let settled = false;

  return {
    reset() {
      radius = HOME_DISTANCE;
      yaw = 0;
      elevation = CRUISE_ELEVATION_BASE;
      currentLook.set(0, 0, 0);
      camera.position.copy(home);
      camera.lookAt(currentLook);
      camera.updateMatrixWorld(true);
      previousPosition.copy(camera.position);
      stillFrames = 0;
      settled = false;
    },

    update(clock, dt, mode, focus) {
      const damping = 1 - Math.exp(-dt / CAMERA_DAMPING);

      /* 目标半径与目标视线：只有巡航要转，聚焦/点击/返回都只沿 z 推拉 */
      const targetRadius =
        mode === "lock"
          ? HOME_DISTANCE * LOCK_RADIUS_RATIO
          : mode === "focus"
            ? HOME_DISTANCE * FOCUS_RADIUS_RATIO
            : HOME_DISTANCE;

      const targetYaw = mode === "cruise" ? Math.sin((clock / CRUISE_PERIOD) * Math.PI * 2) * CRUISE_YAW_AMPLITUDE : 0;
      const targetElevation =
        mode === "cruise"
          ? CRUISE_ELEVATION_BASE +
            Math.sin((clock / CRUISE_PERIOD) * Math.PI * 2) * CRUISE_PITCH_AMPLITUDE
          : CRUISE_ELEVATION_BASE;

      radius += (targetRadius - radius) * damping;
      yaw += (targetYaw - yaw) * damping;
      elevation += (targetElevation - elevation) * damping;

      /* 规范红线：不管上面怎么算，实际半径不得低于初始距离的 40% */
      const clampedRadius = Math.max(radius, HOME_DISTANCE * MIN_RADIUS_RATIO);

      desiredPosition.set(
        clampedRadius * Math.cos(elevation) * Math.sin(yaw),
        clampedRadius * Math.sin(elevation),
        clampedRadius * Math.cos(elevation) * Math.cos(yaw),
      );

      desiredLook.set(0, 0, 0);
      if (focus) desiredLook.copy(focus).multiplyScalar(mode === "lock" ? 0.55 : 0.4);
      currentLook.lerp(desiredLook, damping);

      camera.position.copy(desiredPosition);
      camera.lookAt(currentLook);
      camera.updateMatrixWorld(true);

      /* 稳定性判定：连续 N 帧位移都小于阈值才算稳定 */
      const movement = camera.position.distanceTo(previousPosition);
      previousPosition.copy(camera.position);
      if (movement < SETTLE_EPSILON) {
        stillFrames += 1;
        if (stillFrames >= SETTLE_FRAMES) settled = true;
      } else {
        stillFrames = 0;
        settled = false;
      }
    },

    isSettled() {
      return settled;
    },

    get radius() {
      return radius;
    },
  };
}
