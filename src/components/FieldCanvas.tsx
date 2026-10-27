"use client";

import { useEffect, useRef } from "react";

type FieldCanvasProps = {
  enabled: boolean;
};

/** Tiny deterministic PRNG so the field looks identical after every resize. */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Static background decoration: a faint polar "energy field" hugging the
 * butterfly plus sparse low-opacity star points. Painted once per resize —
 * no animation loop, so it costs nothing per frame.
 */
export default function FieldCanvas({ enabled }: FieldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let frame = 0;

    const draw = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      if (!enabled) return;

      const rand = mulberry32(20261018);
      const compact = width < 640;
      const cx = width / 2;
      const cy = height / 2;

      /* Sparse, ultra-faint stars across the whole stage. */
      const starCount = compact ? 16 : 48;
      for (let i = 0; i < starCount; i += 1) {
        const x = rand() * width;
        const y = rand() * height;
        const radius = 0.6 + rand() * 0.8;
        const alpha = 0.1 + rand() * 0.17;
        ctx.fillStyle = `rgba(170, 228, 255, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      /* Phones skip the grid entirely to stay light. */
      if (compact) return;

      /* Polar grid around the butterfly: concentric arcs + radial spokes,
         both fading out with distance from the centre. */
      const radius = Math.min(width * 0.46, height * 0.62);
      const rx = radius * 1.18;
      const ry = radius * 0.76;
      const rings = 7;

      ctx.lineWidth = 0.9;
      for (let i = 1; i <= rings; i += 1) {
        const t = i / rings;
        const alpha = 0.16 * (1 - t) + 0.035;
        ctx.strokeStyle = `rgba(90, 170, 255, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx * t, ry * t, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      const spokes = 12;
      ctx.strokeStyle = "rgba(90, 170, 255, 0.06)";
      for (let i = 0; i < spokes; i += 1) {
        const angle = (i / spokes) * Math.PI * 2 + Math.PI / 24;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * rx * 0.2, cy + Math.sin(angle) * ry * 0.2);
        ctx.lineTo(cx + Math.cos(angle) * rx * 0.97, cy + Math.sin(angle) * ry * 0.97);
        ctx.stroke();
      }
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    };

    schedule();
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
    };
  }, [enabled]);

  return <canvas ref={canvasRef} className="field-canvas" aria-hidden="true" />;
}
