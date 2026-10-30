"use client";

/* 「在物体上拖 = 改场景参数，在空白处拖 = OrbitControls 转视角」这件事的公共实现。
 *
 * 关键在于：R3F 的 `stopPropagation()` 只能拦住 R3F 自己的事件冒泡，
 * **拦不住 OrbitControls** —— 它是直接挂在 canvas DOM 上的控件，照样会跟着转。
 * 所以必须在按下时显式把 `controls.enabled` 关掉、松手再打开。上一轮就是这么踩的，
 * 封成一个 hook 免得三个场景各踩一次。
 */

import { useCallback, useRef } from "react";
import type { ThreeEvent } from "@react-three/fiber";

type Controls = { enabled: boolean } | null;

type Options = {
  /** 拖拽中的像素位移（相对上一次 move）与原始事件 */
  onDrag: (dx: number, dy: number, event: ThreeEvent<PointerEvent>) => void;
  onEnd?: () => void;
};

export function useSceneDrag({ onDrag, onEnd }: Options) {
  const controls = useRef<Controls>(null);
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  /** 挂到 <OrbitControls ref={drag.attach}> 上 */
  const attach = useCallback((instance: unknown) => {
    controls.current = (instance as Controls) ?? null;
  }, []);

  const handlers = {
    onPointerDown: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      dragging.current = true;
      last.current = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY };
      if (controls.current) controls.current.enabled = false;
      /* 抓住指针：手指/鼠标滑出网格时 move 事件仍然送到这里，拖拽不会半路断掉 */
      (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event: ThreeEvent<PointerEvent>) => {
      if (!dragging.current) return;
      event.stopPropagation();
      const dx = event.nativeEvent.clientX - last.current.x;
      const dy = event.nativeEvent.clientY - last.current.y;
      last.current = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY };
      onDrag(dx, dy, event);
    },
    onPointerUp: (event: ThreeEvent<PointerEvent>) => {
      if (!dragging.current) return;
      event.stopPropagation();
      dragging.current = false;
      if (controls.current) controls.current.enabled = true;
      (event.target as Element | null)?.releasePointerCapture?.(event.pointerId);
      onEnd?.();
    },
    onPointerLeave: () => {
      if (!dragging.current) return;
      dragging.current = false;
      if (controls.current) controls.current.enabled = true;
      onEnd?.();
    },
  };

  return { attach, handlers, isDragging: dragging };
}
