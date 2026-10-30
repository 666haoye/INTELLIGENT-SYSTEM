"use client";

/* E08「PCA 降维与重建」的沉浸版：粒子星云 + 捏压式交互。
 *
 * 交互只有一件事：按住星云拖 = 沿拖拽方向把点云「捏扁」。但捏扁改的是**协方差矩阵本身**，
 * 于是特征向量跟着转、玻璃主成分板追着转、红色残差线全部重算 —— 主方向是被算出来的。
 * 空白处拖 = 转视角（useSceneDrag 统一处理两者的冲突）。
 *
 * 数学全在 src/lib/lab3d/pca-cloud.ts，这个文件不重复任何计算。
 */

import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { AdaptiveDpr, MeshTransmissionMaterial, OrbitControls, PerformanceMonitor } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { damp3, dampQ } from "maath/easing";
import * as THREE from "three";
import {
  makeCloud,
  normalize,
  principalFrame,
  projection,
  squeezeInto,
  type PrincipalFrame,
  type Vec3,
} from "@/lib/lab3d/pca-cloud";
import { labCopy } from "@/lib/lab3d/experiment-copy";
import PerfProbe, { type PerfSample } from "./PerfProbe";
import { useSceneDrag } from "./useSceneDrag";

const COPY = labCopy("E08");

const COUNT = 4000;
/** 红色残差线抽稀：每 8 个粒子画一条，500 段足够读出投影结构。 */
const RESIDUAL_STRIDE = 8;
/** 拖动一像素压多少（累积到 amount，clamp 0~1）。 */
const SQUEEZE_GAIN = 0.0035;

type SqueezeState = { axis: Vec3; amount: number };

function Nebula({
  squeezeRef,
  onFrame,
}: {
  squeezeRef: React.MutableRefObject<SqueezeState>;
  onFrame: (frame: PrincipalFrame, amount: number) => void;
}) {
  const cloud = useMemo(() => makeCloud(COUNT), []);
  const scratch = useMemo(() => new Float32Array(cloud.length), [cloud]);

  const pointsRef = useRef<THREE.Points>(null);
  const planeRef = useRef<THREE.Group>(null);
  const linesRef = useRef<THREE.LineSegments>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(cloud.slice(), 3));
    return geo;
  }, [cloud]);

  const residualGeometry = useMemo(() => {
    const samples = Math.ceil(COUNT / RESIDUAL_STRIDE);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(samples * 6), 3));
    return geo;
  }, []);

  const applied = useRef({ amount: -1, axis: [0, 0, 1] as Vec3 });
  const targetQuat = useMemo(() => new THREE.Quaternion(), []);
  const targetPos = useMemo(() => new THREE.Vector3(), []);
  const basis = useMemo(() => new THREE.Matrix4(), []);
  const every = useRef(0);

  useFrame((_, delta) => {
    const { axis, amount } = squeezeRef.current;
    const changed =
      Math.abs(amount - applied.current.amount) > 0.002 ||
      axis.some((v, i) => Math.abs(v - applied.current.axis[i]) > 0.002);

    if (changed) {
      applied.current = { amount, axis };
      squeezeInto(cloud, scratch, axis, amount);

      const frame = principalFrame(scratch);

      /* 点云位置整体换成挤压后的坐标 */
      const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
      (pos.array as Float32Array).set(scratch);
      pos.needsUpdate = true;
      geometry.computeBoundingSphere();

      /* 玻璃板的目标位姿：中心 = 质心，法线 = pc3（三个特征向量按列拼成旋转） */
      basis.makeBasis(
        new THREE.Vector3(...frame.pc1),
        new THREE.Vector3(...frame.pc2),
        new THREE.Vector3(...frame.pc3),
      );
      targetQuat.setFromRotationMatrix(basis);
      targetPos.set(...frame.center);

      /* 红色残差：从粒子垂直落到主平面上 */
      const rp = residualGeometry.getAttribute("position") as THREE.BufferAttribute;
      const out = rp.array as Float32Array;
      let cursor = 0;
      for (let i = 0; i < COUNT; i += RESIDUAL_STRIDE) {
        const p: Vec3 = [scratch[i * 3], scratch[i * 3 + 1], scratch[i * 3 + 2]];
        const { point } = projection(p, frame.center, frame.pc1, frame.pc2);
        out[cursor++] = p[0];
        out[cursor++] = p[1];
        out[cursor++] = p[2];
        out[cursor++] = point[0];
        out[cursor++] = point[1];
        out[cursor++] = point[2];
      }
      rp.needsUpdate = true;

      /* 只有压缩程度真的变了才重报 HUD，拖拽时按 ~10Hz 刷新 */
      every.current += 1;
      if (every.current % 3 === 1) onFrame(frame, amount);
    }

    /* 玻璃板与光柱用 maath 的阻尼去「追」目标位姿：板子是被拖过去的，不是瞬移的。 */
    if (planeRef.current) {
      dampQ(planeRef.current.quaternion, targetQuat, 0.28, delta);
      damp3(planeRef.current.position, targetPos, 0.28, delta);
    }
    if (linesRef.current) {
      const material = linesRef.current.material as THREE.LineBasicMaterial;
      /* 轻微脉冲，读起来像「实时重算中」 */
      material.opacity = 0.32 + 0.18 * Math.sin(performance.now() * 0.004);
    }
  });

  return (
    <group>
      <points ref={pointsRef} geometry={geometry} raycast={() => null}>
        <pointsMaterial
          size={0.021}
          sizeAttenuation
          color="#9fe8ff"
          transparent
          opacity={0.55}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      <lineSegments ref={linesRef} geometry={residualGeometry} raycast={() => null}>
        <lineBasicMaterial
          color="#ff5f7a"
          transparent
          opacity={0.4}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>

      {/* 主成分平面：过质心、由 pc1/pc2 张成 */}
      {/* 玻璃板 + 线框同组：玻璃在纯暗背景上几乎看不见，
          必须靠一层网格线才读得出「那是一块板」，两者一起被阻尼拖过去 */}
      <group ref={planeRef}>
        <mesh raycast={() => null}>
          <planeGeometry args={[4.6, 4.6, 1, 1]} />
          <MeshTransmissionMaterial
            transmission={1}
            thickness={0.35}
            roughness={0.12}
            chromaticAberration={0.5}
            anisotropicBlur={0.3}
            distortion={0.2}
            distortionScale={0.35}
            temporalDistortion={0.05}
            ior={1.3}
            samples={4}
            resolution={256}
            background={new THREE.Color("#05060f")}
          />
        </mesh>
        <mesh raycast={() => null}>
          <planeGeometry args={[4.6, 4.6, 14, 14]} />
          <meshBasicMaterial
            color="#7dd3fc"
            wireframe
            transparent
            opacity={0.18}
            depthWrite={false}
          />
        </mesh>
      </group>
    </group>
  );
}

export default function PcaCloudScene() {
  const squeezeRef = useRef<SqueezeState>({ axis: [0, 1, 0], amount: 0 });
  const [explained, setExplained] = useState<Vec3>([1 / 3, 1 / 3, 1 / 3]);
  const [amount, setAmount] = useState(0);
  const [perf, setPerf] = useState<PerfSample>({ fps: 0, calls: 0, tris: 0 });
  const [degraded, setDegraded] = useState(false);
  const [axisLabel, setAxisLabel] = useState("Y");

  const onFrame = useCallback((frame: PrincipalFrame, nextAmount: number) => {
    /* 浮点误差会让 λ3 占比变成 -2e-16，显示前夹一下 */
    setExplained([Math.max(0, frame.explained[0]), Math.max(0, frame.explained[1]), Math.max(0, frame.explained[2])]);
    setAmount(nextAmount);
  }, []);

  /* 拖拽方向（屏幕 XY）就是挤压轴，必须归一化 —— squeezeInto 的公式 p−a(p·a)
     只在 a 是单位向量时才是「沿该轴压扁」，不归一化会变成一个缩放的斜投影。 */
  const drag = useSceneDrag({
    onDrag: (dx, dy) => {
      const length = Math.hypot(dx, dy);
      if (length < 0.6) return;
      squeezeRef.current = {
        axis: normalize([dx, -dy, 0]),
        amount: Math.min(1, squeezeRef.current.amount + length * SQUEEZE_GAIN),
      };
      setAxisLabel(
        Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "X+" : "X−") : dy > 0 ? "Y−" : "Y+",
      );
    },
  });

  const resetSqueeze = useCallback(() => {
    squeezeRef.current = { ...squeezeRef.current, amount: 0 };
    setAmount(0);
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 0.2 : 0.06;
    const cur = squeezeRef.current;
    if (event.key === "ArrowUp" || event.key === "ArrowRight")
      squeezeRef.current = { ...cur, amount: Math.min(1, cur.amount + step) };
    else if (event.key === "ArrowDown" || event.key === "ArrowLeft")
      squeezeRef.current = { ...cur, amount: Math.max(0, cur.amount - step) };
    else if (event.key === "Home") squeezeRef.current = { ...cur, amount: 0 };
    else if (event.key === "End") squeezeRef.current = { ...cur, amount: 1 };
    else return;
    event.preventDefault();
    setAmount(squeezeRef.current.amount);
  };

  const saved2d = (explained[0] + explained[1]) * 100;

  return (
    <div className="min-h-screen bg-[#05060f] text-[#dff6ff]">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-cyan-100/10 px-5 py-4">
        <div className="min-w-0">
          <p className="text-[10px] tracking-[0.2em] text-cyan-200/50">R3F · {COPY.code} · 粒子星云挤压</p>
          <h1 className="text-lg font-semibold">{COPY.title}</h1>
          <p className="text-xs text-cyan-100/50">{COPY.source}</p>
        </div>
        <dl className="flex flex-wrap gap-5 text-[11px] font-mono">
          {[
            ["λ₁ 占比", `${(explained[0] * 100).toFixed(1)}%`],
            ["λ₂ 占比", `${(explained[1] * 100).toFixed(1)}%`],
            ["λ₃ 占比", `${(explained[2] * 100).toFixed(1)}%`],
            ["保留方差(2D)", `${saved2d.toFixed(1)}%`],
            ["挤压", `${(amount * 100).toFixed(0)}% ${axisLabel}`],
            ["FPS", String(perf.fps || "—")],
            ["draw calls", String(perf.calls || "—")],
            ["triangles", (perf.tris || 0).toLocaleString()],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-cyan-200/40">{k}</dt>
              <dd className="text-sm text-cyan-100">{v}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div
        className="h-[min(72vh,720px)] w-full outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
        tabIndex={0}
        role="application"
        aria-label="PCA 粒子星云。拖拽挤压改变主成分方向，方向键微调挤压量。"
        onKeyDown={onKeyDown}
      >
        <Canvas dpr={[1, 2]} camera={{ position: [3.6, 2.6, 4.6], fov: 46 }} gl={{ antialias: true }}>
          <color attach="background" args={["#05060f"]} />
          <ambientLight intensity={0.7} />
          <directionalLight position={[4, 6, 3]} intensity={0.9} />
          <Suspense fallback={null}>
            {/* 整个点云都吃拖拽：粒子太细，命中率靠一层不可见的包围球兜住。
                材质 visible={false} 不影响射线检测（射线检测看的是 mesh.visible，它仍是 true）。 */}
            <mesh {...drag.handlers} onDoubleClick={resetSqueeze}>
              <sphereGeometry args={[2.9, 16, 16]} />
              <meshBasicMaterial visible={false} />
            </mesh>
            <Nebula squeezeRef={squeezeRef} onFrame={onFrame} />
            <EffectComposer>
              <Bloom mipmapBlur intensity={0.55} luminanceThreshold={0.82} luminanceSmoothing={0.18} />
            </EffectComposer>
            <PerformanceMonitor onDecline={() => setDegraded(true)} onFallback={() => setDegraded(true)} />
            {degraded ? <AdaptiveDpr pixelated /> : null}
            <PerfProbe onSample={setPerf} />
            <OrbitControls ref={drag.attach} makeDefault enablePan={false} enableDamping dampingFactor={0.08} />
          </Suspense>
        </Canvas>
      </div>

      <div className="px-5 py-4 text-xs leading-relaxed">
        <p className="text-cyan-100/70">
          <b className="text-cyan-50">怎么玩：</b>在星云上<b>按住拖动</b> = 沿拖拽方向把点云捏扁
          （越拖越扁，松手后保留形状，双击空白处复位）；空白处拖 = 转视角；聚焦场景后
          ↑/↓ 微调挤压、Home/End 到两端。
        </p>
        <p className="mt-2 text-cyan-100/55">
          那块玻璃就是<b>主成分平面</b>：过质心、由前两个主成分张成。你把它捏扁的那一刻，
          协方差矩阵变了，特征向量跟着转，板子会<b>带着阻尼追过去</b> ——
          红色光柱是每个粒子到平面上的残差，也是 PCA 丢掉的那部分。
          当前丢掉第三主成分后仍保留 <b>{saved2d.toFixed(1)}%</b> 的方差。
        </p>
        <p className="mt-2 text-cyan-100/40">{COPY.acceptance}</p>
        <p className="mt-1 text-cyan-100/40">结论：{COPY.conclusion}</p>
        {degraded ? (
          <p className="mt-2 text-amber-300/70">帧率偏低，已自动降低渲染分辨率（AdaptiveDpr）。</p>
        ) : null}
      </div>
    </div>
  );
}
