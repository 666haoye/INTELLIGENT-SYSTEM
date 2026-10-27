"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ModuleNode, NodeId, WingSide } from "@/lib/nodes";

type WingNodeProps = {
  node: ModuleNode;
  onOpen: (node: ModuleNode, trigger: HTMLButtonElement | null) => void;
  onHoverChange: (side: WingSide | null) => void;
  registerRef: (id: NodeId, element: HTMLButtonElement | null) => void;
};

type Ripple = { id: number };

export default function WingNode({
  node,
  onOpen,
  onHoverChange,
  registerRef,
}: WingNodeProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const rippleId = useRef(0);
  const rippleTimers = useRef<number[]>([]);
  const [ripples, setRipples] = useState<Ripple[]>([]);

  useEffect(() => {
    return () => {
      rippleTimers.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const setRef = useCallback(
    (element: HTMLButtonElement | null) => {
      buttonRef.current = element;
      registerRef(node.id, element);
    },
    [node.id, registerRef],
  );

  const handleOpen = useCallback(() => {
    const id = ++rippleId.current;
    setRipples((current) => [...current.slice(-2), { id }]);

    const timer = window.setTimeout(() => {
      setRipples((current) => current.filter((ripple) => ripple.id !== id));
    }, 900);
    rippleTimers.current.push(timer);

    onOpen(node, buttonRef.current);
  }, [node, onOpen]);

  return (
    <div
      className="wing-node-anchor"
      style={{ left: `${node.x * 100}%`, top: `${node.y * 100}%` }}
      onPointerEnter={() => onHoverChange(node.side)}
      onPointerLeave={() => onHoverChange(null)}
      onClick={handleOpen}
    >
      <button
        ref={setRef}
        type="button"
        className="wing-node"
        aria-label={`打开${node.title}面板`}
        aria-haspopup="dialog"
        onFocus={() => onHoverChange(node.side)}
        onBlur={() => onHoverChange(null)}
      >
        <span className="wing-node__orbit" aria-hidden="true" />
        <span className="wing-node__halo" aria-hidden="true" />
        <span className="wing-node__ring" aria-hidden="true" />
        <span className="wing-node__guide" aria-hidden="true" />
        <span className="wing-node__core" aria-hidden="true" />
        <span className="wing-node__flare" aria-hidden="true" />
      </button>

      <span className="wing-node__label" aria-hidden="true">
        {node.title}
      </span>

      <span className="wing-node__ripples" aria-hidden="true">
        {ripples.map((ripple) => (
          <span key={ripple.id} className="wing-node__ripple" />
        ))}
      </span>
    </div>
  );
}
