/* 相机推镜防抖 · 第一层：不可见球形热区判定。
 *
 * 横跳链路是这样的：hover → 相机 focus（半径 ×0.82）→ 透视变化 → 锚点从指针底下走开
 * → pointerleave → 相机回位 → 投影回弹 → pointerenter → 循环。
 * 根因是"hover 由 DOM 矩形决定，而 DOM 矩形跟不上推镜后的画面"。
 * 所以这里改用**射线 × 球**的解析判定：球心就是环心（跟着折叠与推镜一起动），
 * 半径取外环 ×1.15，于是命中边界永远等于视觉边界。
 *
 * 两个刻意的选择：
 *  1) 不建 Mesh、不用 THREE.Raycaster。热区本来就是一个纯球体，解析求交几十次乘法就够，
 *     省掉 4 个几何体，也免得纠结"visible:false 到底进不进 raycast 列表"。
 *  2) DOM 命中（键盘 focus / 标签）作为**并集**输入，因为标签在环下缘、射线覆盖不到；
 *     出口只有一个：300ms 离开迟滞。进入不延迟，保持导航入口的跟手感。
 */
import * as THREE from "three";

import { MODULE_NODES, type NodeId } from "../nodes";
import { HOTZONE_RADIUS } from "./node-rings";
import { toWorldSize } from "./design-space";

/** 指针离开热区后要持续这么久才提交 leave（规范红线：防边缘横跳） */
export const LEAVE_DELAY = 0.3;

/**
 * 容器矩形缓存时长（ms）。节能档 .butterfly-float 还有 ±9px 的 CSS 浮动，
 * 100ms 内误差不到 0.1px，却把每次 pointermove 一次的强制布局摊掉了。
 */
const RECT_TTL = 100;

export type HoverResolver = {
  /** 屏幕坐标（clientX/clientY），换算 NDC 时用缓存的容器矩形 */
  setPointer(clientX: number, clientY: number): void;
  clearPointer(): void;
  /** DOM 侧的 hover 输入（键盘 focus / blur），与射线判定取并集 */
  setDomHover(id: NodeId | null): void;
  /** 容器尺寸变了：矩形作废 */
  invalidateRect(): void;
  /** 每帧调用：返回经过迟滞处理的 hover 节点 */
  resolve(dt: number): NodeId | null;
  inspect(): { ray: NodeId | null; dom: NodeId | null; committed: NodeId | null; leave: number };
};

export function createHoverResolver(
  camera: THREE.Camera,
  host: HTMLElement,
  positionOf: (id: NodeId, out: THREE.Vector3) => THREE.Vector3 | null,
  radiusPx: number = HOTZONE_RADIUS,
): HoverResolver {
  const radius = toWorldSize(radiusPx);
  const radiusSq = radius * radius;

  const center = new THREE.Vector3();
  const toCenter = new THREE.Vector3();
  const rayDir = new THREE.Vector3();

  /* 指针位置用两个标量存：每帧 new 一个对象纯属白给的 GC 压力 */
  let pointerX = Number.NaN;
  let pointerY = Number.NaN;
  let rect: DOMRect | null = null;
  let rectAt = 0;
  let domHover: NodeId | null = null;
  let committed: NodeId | null = null;
  let leaveElapsed = 0;
  let lastRay: NodeId | null = null;

  function currentRect(): DOMRect | null {
    const now = performance.now();
    if (!rect || now - rectAt > RECT_TTL) {
      rect = host.getBoundingClientRect();
      rectAt = now;
    }
    return rect && rect.width > 0 && rect.height > 0 ? rect : null;
  }

  function pick(): NodeId | null {
    lastRay = null;
    if (Number.isNaN(pointerX)) return domHover;

    const box = currentRect();
    if (!box) return domHover;

    const x = ((pointerX - box.left) / box.width) * 2 - 1;
    const y = -(((pointerY - box.top) / box.height) * 2 - 1);

    /* 相机可能刚被 rig 写过位姿，matrixWorld 必须刷新才能正确 unproject */
    camera.updateMatrixWorld();
    rayDir.set(x, y, 0.5).unproject(camera).sub(camera.position).normalize();

    let found: NodeId | null = null;
    let nearest = Number.POSITIVE_INFINITY;

    for (const node of MODULE_NODES) {
      if (!positionOf(node.id, center)) continue;
      toCenter.copy(center).sub(camera.position);

      const along = toCenter.dot(rayDir);
      /* 球在相机背后：射线是单向的，不可能命中 */
      if (along < 0) continue;

      /* 射线到球心的垂距平方：和半径²直接比，命中前不用开方 */
      const perpSq = toCenter.lengthSq() - along * along;
      if (perpSq > radiusSq) continue;

      const t = along - Math.sqrt(Math.max(0, radiusSq - perpSq));
      if (t < nearest) {
        nearest = t;
        found = node.id;
      }
    }

    lastRay = found;
    /* 射线没打中时仍然承认 DOM 侧（键盘 focus、标签热区） */
    return found ?? domHover;
  }

  return {
    setPointer(clientX, clientY) {
      pointerX = clientX;
      pointerY = clientY;
    },

    clearPointer() {
      pointerX = Number.NaN;
      pointerY = Number.NaN;
    },

    setDomHover(id) {
      domHover = id;
    },

    invalidateRect() {
      rect = null;
    },

    resolve(dt) {
      const candidate = pick();

      if (candidate) {
        leaveElapsed = 0;
        /* 进入与切换都不延迟：手已经指到环上了，不该再等 */
        committed = candidate;
      } else if (committed) {
        leaveElapsed += dt;
        if (leaveElapsed >= LEAVE_DELAY) {
          committed = null;
          leaveElapsed = 0;
        }
      }

      return committed;
    },

    inspect() {
      return { ray: lastRay, dom: domHover, committed, leave: Number(leaveElapsed.toFixed(3)) };
    },
  };
}
