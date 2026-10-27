"use client";

import { useEffect, useRef } from "react";
import type { NodeId } from "@/lib/nodes";

export type TrailTarget = {
  id: NodeId;
  x: number;
  y: number;
};

type TrailsCanvasProps = {
  enabled: boolean;
  paused: boolean;
  quiet: boolean;
  count: number;
  getTargets: () => TrailTarget[];
  onNodeLit: (id: NodeId) => void;
  onNodeNear: (id: NodeId) => void;
};

type Point = { x: number; y: number };

/* One trail either fades mid-flight, is consumed by its node, or leaves the screen. */
type TrailMode = "midway" | "node" | "boundary";

type Trail = {
  samples: Point[];
  lengths: number[];
  total: number;
  progress: number;
  speed: number;
  tail: number;
  hue: number;
  mode: TrailMode;
  fadeAt: number;
  target: NodeId | null;
  targetPoint: Point | null;
  /* Once a trail enters its ending it freezes and fades out in place. */
  dying: boolean;
  fade: number;
};

const NODE_HIT_RADIUS = 96;
const NODE_NEAR_RADIUS = 96;
const NODE_HIT_COOLDOWN = 900;
const NODE_NEAR_COOLDOWN = 800;

const rand = (min: number, max: number) => min + Math.random() * (max - min);

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/** Samples a Catmull-Rom spline through every control point. */
function sampleSpline(control: Point[], perSegment = 24): Point[] {
  if (control.length < 2) return control;

  const padded = [control[0], ...control, control[control.length - 1]];
  const samples: Point[] = [];

  for (let i = 1; i < padded.length - 2; i += 1) {
    const p0 = padded[i - 1];
    const p1 = padded[i];
    const p2 = padded[i + 1];
    const p3 = padded[i + 2];

    for (let step = 0; step < perSegment; step += 1) {
      const t = step / perSegment;
      samples.push({
        x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
        y: catmullRom(p0.y, p1.y, p2.y, p3.y, t),
      });
    }
  }

  samples.push(control[control.length - 1]);
  return samples;
}

function getCumulativeLengths(samples: Point[]): number[] {
  const lengths = [0];
  for (let i = 1; i < samples.length; i += 1) {
    const dx = samples[i].x - samples[i - 1].x;
    const dy = samples[i].y - samples[i - 1].y;
    lengths.push(lengths[i - 1] + Math.hypot(dx, dy));
  }
  return lengths;
}

function pointAtDistance(
  samples: Point[],
  lengths: number[],
  distance: number,
): Point {
  if (distance <= 0) return samples[0];
  const total = lengths[lengths.length - 1];
  if (distance >= total) return samples[samples.length - 1];

  let low = 0;
  let high = lengths.length - 1;
  while (low < high - 1) {
    const mid = (low + high) >> 1;
    if (lengths[mid] <= distance) low = mid;
    else high = mid;
  }

  const span = lengths[high] - lengths[low] || 1;
  const ratio = (distance - lengths[low]) / span;
  return {
    x: samples[low].x + (samples[high].x - samples[low].x) * ratio,
    y: samples[low].y + (samples[high].y - samples[low].y) * ratio,
  };
}

export default function TrailsCanvas({
  enabled,
  paused,
  quiet,
  count,
  getTargets,
  onNodeLit,
  onNodeNear,
}: TrailsCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(
      window.devicePixelRatio || 1,
      window.innerWidth < 768 ? 1.25 : 1.5,
    );
    let width = 0;
    let height = 0;
    let frame = 0;
    let lastTime = performance.now();
    let trails: Trail[] = [];
    const lastHit: Partial<Record<NodeId, number>> = {};
    const lastNear: Partial<Record<NodeId, number>> = {};

    const fitCanvas = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const makeTrail = (index: number): Trail => {
      const targets = getTargets().filter(
        (target) =>
          target.x > -20 &&
          target.x < width + 20 &&
          target.y > -20 &&
          target.y < height + 20,
      );

      /* ~1/3 consumed by a node, ~1/3 fades mid-flight, ~1/3 exits the screen. */
      const roll = Math.random();
      const wantNode = roll < 0.36 && targets.length > 0;
      const mode: TrailMode = wantNode ? "node" : roll < 0.68 ? "midway" : "boundary";
      const target = wantNode
        ? targets[Math.floor(Math.random() * targets.length)]
        : undefined;

      /* Every trail slides from the top-right corner to the bottom-left corner. */
      const start: Point = { x: width * 1.14, y: -height * 0.12 };
      const end: Point = { x: -width * 0.14, y: height * 1.12 };

      let control: Point[];
      if (target) {
        const anchor: Point = { x: target.x + rand(-10, 10), y: target.y + rand(-10, 10) };
        control = [
          start,
          {
            x: start.x + (anchor.x - start.x) * rand(0.45, 0.62),
            y: start.y + (anchor.y - start.y) * rand(0.12, 0.32),
          },
          anchor,
          {
            x: anchor.x + (end.x - anchor.x) * rand(0.38, 0.55),
            y: anchor.y + (end.y - anchor.y) * rand(0.2, 0.42),
          },
          end,
        ];
      } else {
        control = [
          start,
          {
            x: start.x + (end.x - start.x) * rand(0.22, 0.34) + rand(-width * 0.06, width * 0.06),
            y: start.y + (end.y - start.y) * rand(0.16, 0.3),
          },
          {
            x: start.x + (end.x - start.x) * rand(0.62, 0.78) + rand(-width * 0.06, width * 0.06),
            y: start.y + (end.y - start.y) * rand(0.64, 0.8),
          },
          end,
        ];
      }

      const samples = sampleSpline(control);
      const lengths = getCumulativeLengths(samples);
      const total = lengths[lengths.length - 1];
      const duration = rand(6.6, 10.8) * (quiet ? 1.5 : 1);

      return {
        samples,
        lengths,
        total,
        progress: rand(0.01, 0.55),
        speed: 1 / (duration * 1000),
        tail: Math.min(340, Math.max(180, width * rand(0.14, 0.24))),
        hue: index % 2,
        mode,
        fadeAt: mode === "midway" ? rand(0.28, 0.72) : 1,
        target: target?.id ?? null,
        targetPoint: target ? { x: target.x, y: target.y } : null,
        dying: false,
        fade: 1,
      };
    };

    const resetTrails = () => {
      const budget = Math.min(count, 4); /* PC 同时最多 4 条流星 */
      trails = Array.from({ length: budget }, (_, index) => makeTrail(index));
    };

    if (!enabled) {
      fitCanvas();
      ctx.clearRect(0, 0, width, height);
      return;
    }

    if (paused) {
      return;
    }

    fitCanvas();
    resetTrails();

    const draw = (trail: Trail, dt: number, index: number, targets: TrailTarget[]) => {
      if (!trail.dying) {
        trail.progress += dt * trail.speed;
        if (trail.progress > 1.14) {
          Object.assign(trail, makeTrail(index));
        }
      }

      const headDist = Math.min(trail.total, trail.progress * trail.total);
      const tailDist = Math.max(0, headDist - trail.tail);
      if (headDist <= 0) return;

      const head = pointAtDistance(trail.samples, trail.lengths, headDist);
      const tail = pointAtDistance(trail.samples, trail.lengths, tailDist);

      const now = performance.now();

      /* Passing any interactive node: it grows a touch and brightens. */
      if (!trail.dying) {
        for (const nodeTarget of targets) {
          if (
            now - (lastNear[nodeTarget.id] ?? 0) > NODE_NEAR_COOLDOWN &&
            Math.hypot(head.x - nodeTarget.x, head.y - nodeTarget.y) < NODE_NEAR_RADIUS
          ) {
            lastNear[nodeTarget.id] = now;
            onNodeNear(nodeTarget.id);
          }
        }
      }

      /* Touching its own node: ripple + armed state, the trail is consumed. */
      if (
        !trail.dying &&
        trail.mode === "node" &&
        trail.progress < 1.02 &&
        trail.target &&
        trail.targetPoint
      ) {
        if (
          now - (lastHit[trail.target] ?? 0) > NODE_HIT_COOLDOWN &&
          Math.hypot(head.x - trail.targetPoint.x, head.y - trail.targetPoint.y) <
            NODE_HIT_RADIUS
        ) {
          lastHit[trail.target] = now;
          onNodeLit(trail.target);
          trail.dying = true;
        }
      }

      /* Midway trails dissolve on their own before reaching any edge. */
      if (!trail.dying && trail.mode === "midway" && trail.progress >= trail.fadeAt) {
        trail.dying = true;
      }

      if (trail.dying) {
        trail.fade -= dt / 300;
        if (trail.fade <= 0) {
          Object.assign(trail, makeTrail(index));
          return;
        }
      }

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, trail.fade));

      ctx.beginPath();
      let first = true;
      for (let i = 0; i < trail.samples.length; i += 1) {
        const distance = trail.lengths[i];
        if (distance < tailDist || distance > headDist) continue;
        const point = trail.samples[i];
        if (first) {
          ctx.moveTo(point.x, point.y);
          first = false;
        } else {
          ctx.lineTo(point.x, point.y);
        }
      }
      if (first) ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(head.x, head.y);

      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // wide atmospheric beam (kept slim)
      const outer = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
      outer.addColorStop(0, "rgba(29, 78, 216, 0)");
      outer.addColorStop(0.7, "rgba(37, 99, 235, 0.05)");
      outer.addColorStop(1, "rgba(56, 189, 248, 0.13)");
      ctx.strokeStyle = outer;
      ctx.lineWidth = 9;
      ctx.stroke();

      // soft halo
      const glow = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
      glow.addColorStop(0, "rgba(29, 78, 216, 0)");
      glow.addColorStop(0.66, "rgba(37, 99, 235, 0.14)");
      glow.addColorStop(1, "rgba(56, 189, 248, 0.38)");
      ctx.strokeStyle = glow;
      ctx.lineWidth = 5;
      ctx.stroke();

      // filament core — a slim streak, no round head
      const line = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
      if (trail.hue === 0) {
        line.addColorStop(0, "rgba(37, 99, 235, 0)");
        line.addColorStop(0.54, "rgba(34, 211, 238, 0.5)");
        line.addColorStop(1, "rgba(232, 254, 255, 1)");
      } else {
        line.addColorStop(0, "rgba(29, 78, 216, 0)");
        line.addColorStop(0.58, "rgba(59, 130, 246, 0.48)");
        line.addColorStop(1, "rgba(202, 243, 255, 0.98)");
      }
      ctx.strokeStyle = line;
      ctx.lineWidth = trail.hue === 0 ? 1.45 : 1.25;
      ctx.stroke();

      ctx.restore();
    };

    ctx.globalCompositeOperation = "lighter";
    const render = (time: number) => {
      const dt = Math.min(48, Math.max(1, time - lastTime));
      lastTime = time;

      ctx.clearRect(0, 0, width, height);
      const targets = getTargets();
      trails.forEach((trail, index) => draw(trail, dt, index, targets));
      frame = requestAnimationFrame(render);
    };

    const onResize = () => {
      fitCanvas();
      resetTrails();
    };

    window.addEventListener("resize", onResize, { passive: true });
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, [count, enabled, getTargets, onNodeLit, onNodeNear, paused, quiet]);

  return (
    <canvas
      ref={canvasRef}
      className="trails-canvas"
      aria-hidden="true"
      data-trail-count={count}
    />
  );
}
