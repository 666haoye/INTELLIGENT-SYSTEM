"use client";

/* R3F 的 <Canvas> 不能在服务端渲染（服务端没有 WebGL 上下文），所以整页 ssr: false 动态加载。 */

import dynamic from "next/dynamic";

const XorFoldScene = dynamic(() => import("@/components/lab3d/XorFoldScene"), {
  ssr: false,
  loading: () => (
    <p className="min-h-screen bg-[#02060d] px-5 py-6 text-xs text-cyan-100/50">
      正在载入 3D 场景…
    </p>
  ),
});

export default function LabE12Page() {
  return <XorFoldScene />;
}
