"use client";

import { useCallback, useRef } from "react";
import type { ModuleNode, NodeId } from "@/lib/nodes";

type WingNodeProps = {
  node: ModuleNode;
  onOpen: (node: ModuleNode, trigger: HTMLButtonElement | null) => void;
  /**
   * 只报键盘 focus / blur。鼠标那一路的 hover 判定已经交给 3D 的热区射线
   * （见 hover-raycast.ts）：推镜会改透视，DOM 矩形跟不上画面，
   * 两个源各说各话就是"相机在拉近/恢复之间横跳"的根因。
   */
  onHoverChange: (node: ModuleNode | null) => void;
  registerRef: (id: NodeId, element: HTMLButtonElement | null) => void;
};

/**
 * 节点这一层现在只负责三件事：可点击的热区、可聚焦的按钮、清晰的文字标签。
 *
 * 原来的 orbit / halo / ring / guide / core / flare 六层 CSS 视觉与点击波纹已整体交给
 * 3D 的节点环与能量反馈 —— 两套视觉叠在一起会互相压亮，而且 3D 已经接管了 hover 提亮。
 * 标签继续留在 DOM：文字由浏览器排版才锐利，也不会跟着透视变形。
 */
export default function WingNode({
  node,
  onOpen,
  onHoverChange,
  registerRef,
}: WingNodeProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const setRef = useCallback(
    (element: HTMLButtonElement | null) => {
      buttonRef.current = element;
      registerRef(node.id, element);
    },
    [node.id, registerRef],
  );

  const handleOpen = useCallback(() => {
    onOpen(node, buttonRef.current);
  }, [node, onOpen]);

  return (
    <div
      className="wing-node-anchor"
      data-node-id={node.id}
      style={{ left: `${node.x * 100}%`, top: `${node.y * 100}%` }}
      onClick={handleOpen}
    >
      <button
        ref={setRef}
        type="button"
        className="wing-node"
        aria-label={`打开${node.title}面板`}
        aria-haspopup="dialog"
        onFocus={() => onHoverChange(node)}
        onBlur={() => onHoverChange(null)}
      />

      <span className="wing-node__label" aria-hidden="true">
        {node.title}
      </span>
    </div>
  );
}
