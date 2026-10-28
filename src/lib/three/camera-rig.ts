/* 相机运镜（阶段 1.5 收敛版）：默认近乎静止的正面构图，聚焦靠阻尼推镜，永不贴脸。
 *
 * 四条硬约束：
 *  1) 半径硬下限 0.4×初始距离（规范红线），用 Math.max 夹在每一帧，不依赖调用方自觉。
 *  2) 只用指数阻尼插值（1 - exp(-dt/τ)），与帧率无关；没有线性插值、没有急停急启。
 *  3) 只有巡航会转：focus 把姿态冻在当下，lock / return 才归零 —— 镜头不会一边转一边推，
 *     这是消除 3D 晕眩最有效的一条。
 *  4) **focus 推镜不得移动被聚焦节点的投影位置**：沿「机位 → 节点」这条射线推进，
 *     相机朝向又保持不动，于是节点在屏幕上一动不动。实测原先的「拉近 + lookAt 拉向节点
 *     + 偏航归零」三件事叠加，会把节点朝画面中心推 42 CSS 像素 —— 比整个热区半径
 *     （41.7）还大，指针当场掉出自己触发的热区、hover 撤销、相机回位、hover 又回来，
 *     这就是用户报的横跳根因。
 *     lock 保留原来的"把节点拉进构图"，因为那时 hover 已被状态机忽略，且点击已经完成。
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
  const pivot = new THREE.Vector3();
  const toFocus = new THREE.Vector3();

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

      /* focus 时把姿态**冻在当下**（目标就是当前值，阻尼自然不动）：
         hover 不该让画面转 2° —— 那是 35 CSS 像素的整体平移，比热区半径还大，
         指针会被自己推出去的画面甩掉。归零姿态留给 lock（点击之后 hover 已经无所谓了）。 */
      const targetYaw =
        mode === "focus"
          ? yaw
          : mode === "cruise"
            ? Math.sin((clock / CRUISE_PERIOD) * Math.PI * 2) * CRUISE_YAW_AMPLITUDE
            : 0;
      const targetElevation =
        mode === "focus"
          ? elevation
          : mode === "cruise"
            ? CRUISE_ELEVATION_BASE +
              Math.sin((clock / CRUISE_PERIOD) * Math.PI * 2) * CRUISE_PITCH_AMPLITUDE
            : CRUISE_ELEVATION_BASE;

      radius += (targetRadius - radius) * damping;
      yaw += (targetYaw - yaw) * damping;
      elevation += (targetElevation - elevation) * damping;

      /* 规范红线：不管上面怎么算，实际半径不得低于初始距离的 40% */
      const clampedRadius = Math.max(radius, HOME_DISTANCE * MIN_RADIUS_RATIO);
      const cosElevation = Math.cos(elevation);
      const ratio = clampedRadius / HOME_DISTANCE;

      /* 初始距离处的机位（pivot）。focus 沿「pivot → 环心」的射线往里推，
         其余模式把 pivot 整体收放 —— 收放会连带改变 lookAt 的方向，
         所以 focus 分支必须单独把轴向钉住，见下面。 */
      pivot.set(
        HOME_DISTANCE * cosElevation * Math.sin(yaw),
        HOME_DISTANCE * Math.sin(elevation),
        HOME_DISTANCE * cosElevation * Math.cos(yaw),
      );

      desiredLook.set(0, 0, 0);

      if (mode === "focus" && focus) {
        /* 沿「机位 → 环心」这条射线推进，同时把视线目标挂在位姿上，
           让相机轴向恒等于不推镜时的那条（pivot → 原点）。
           少了后一半，推近会让相机顺手转 ~1.4°，横扫 27 CSS 像素 ——
           环从指针底下溜走、hover 撤销、相机回位、hover 又回来，横跳就是这么来的。
           位姿本身已经过阻尼（ratio 来自 radius），所以朝向直接跟随，不再二次插值。 */
        toFocus.copy(focus).sub(pivot);
        desiredPosition.copy(pivot).addScaledVector(toFocus, 1 - ratio);
        desiredLook.copy(desiredPosition).sub(pivot);
        currentLook.copy(desiredLook);
      } else {
        desiredPosition.copy(pivot).multiplyScalar(ratio);
        if (focus) desiredLook.copy(focus).multiplyScalar(mode === "lock" ? 0.55 : 0.4);
        currentLook.lerp(desiredLook, damping);
      }

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
