"use client";

/* 1Hz 上采样帧率与渲染量。刻意不用 drei 的 <Stats>：
   它依赖 stats-gl，而 stats-gl 带了一份私有的 three@0.170.0，
   引进来会把第二份 three 打进 lab 路由的包里。 */

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";

export type PerfSample = { fps: number; calls: number; tris: number };

export default function PerfProbe({ onSample }: { onSample: (sample: PerfSample) => void }) {
  const frames = useRef(0);
  const elapsed = useRef(0);

  useFrame((state, delta) => {
    frames.current += 1;
    elapsed.current += delta;
    if (elapsed.current < 1) return;
    const info = state.gl.info.render;
    onSample({
      fps: Math.round(frames.current / elapsed.current),
      calls: info.calls,
      tris: info.triangles,
    });
    frames.current = 0;
    elapsed.current = 0;
  });

  return null;
}
