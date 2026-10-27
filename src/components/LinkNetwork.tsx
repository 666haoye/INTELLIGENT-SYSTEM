"use client";

import type { NodeId } from "@/lib/nodes";

const STAGE_W = 1440;
const STAGE_H = 900;
const SEGMENTS = 10;

type Point = { x: number; y: number };

/* Node anchors in the same 1440 × 900 stage as the butterfly SVG. */
const NODE_POINTS: Record<NodeId, Point> = {
  problem: { x: 566, y: 365 },
  knowledge: { x: 874, y: 365 },
  cases: { x: 566, y: 620 },
  sandbox: { x: 874, y: 620 },
};

const CONNECTIONS: Array<[NodeId, NodeId]> = [
  ["problem", "knowledge"],
  ["knowledge", "sandbox"],
  ["sandbox", "cases"],
  ["cases", "problem"],
  ["problem", "sandbox"],
  ["knowledge", "cases"],
];

type LinkSegment = { x1: number; y1: number; x2: number; y2: number };

const LINKS = CONNECTIONS.map(([a, b]) => {
  const start = NODE_POINTS[a];
  const end = NODE_POINTS[b];
  const segments: LinkSegment[] = [];
  for (let i = 0; i < SEGMENTS; i += 1) {
    const t0 = i / SEGMENTS;
    const t1 = (i + 1) / SEGMENTS;
    segments.push({
      x1: start.x + (end.x - start.x) * t0,
      y1: start.y + (end.y - start.y) * t0,
      x2: start.x + (end.x - start.x) * t1,
      y2: start.y + (end.y - start.y) * t1,
    });
  }
  return { key: `${a}-${b}`, a, b, segments };
});

type LinkNetworkProps = {
  armedIds: NodeId[];
  compact: boolean;
};

/**
 * Faint knowledge-association network between the four wing nodes.
 * When a node is activated by a trail, every incident link lights up
 * segment by segment, starting from that node.
 */
export default function LinkNetwork({ armedIds, compact }: LinkNetworkProps) {
  const delayStep = compact ? 0 : 0.06;

  return (
    <svg
      className="link-network"
      viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {LINKS.map(({ key, a, b, segments }) => {
        /* Latest activated endpoint wins, so the wave starts there. */
        let from: NodeId | null = null;
        for (let i = armedIds.length - 1; i >= 0; i -= 1) {
          if (armedIds[i] === a || armedIds[i] === b) {
            from = armedIds[i];
            break;
          }
        }
        const fromB = from === b;

        return (
          <g key={key}>
            {segments.map((segment, index) => {
              const delay = (fromB ? SEGMENTS - 1 - index : index) * delayStep;
              return (
                <line
                  key={index}
                  x1={segment.x1}
                  y1={segment.y1}
                  x2={segment.x2}
                  y2={segment.y2}
                  className={from ? "is-active" : undefined}
                  style={from ? { animationDelay: `${delay.toFixed(2)}s` } : undefined}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
