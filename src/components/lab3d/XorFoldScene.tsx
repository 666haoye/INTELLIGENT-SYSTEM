"use client";

/* E12「两层 MLP 解决 XOR」的 3D 沉浸式版本：空间折叠。
 *
 * 交互只有两件事：竖向拖拽地形 = 把隐藏层的非线性表示「拉」进这个空间；
 * 空白处拖拽 = OrbitControls 转视角。数学全在 src/lib/lab3d/xor-mlp.ts，
 * 这个文件只负责把 lift 这一个标量画出来 —— 渲染层不做任何计算，
 * 因为算错了在后台标签页里我根本看不出来，能被 node 断言的都必须留在那边。
 *
 * 这是仓库里第一个 R3F 场景；蝴蝶场景（ButterflyScene.tsx + src/lib/three/*）走的是 raw three.js。
 * 两套并存是临时的，等 10 个实验决定是否搬进 React 侧时再统一。
 */

import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  AdaptiveDpr,
  MeshTransmissionMaterial,
  OrbitControls,
  PerformanceMonitor,
} from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import {
  DATA_POINTS,
  DOMAIN,
  accuracyAt,
  gridHeights,
  heightAt,
  trainXorMlp,
} from "@/lib/lab3d/xor-mlp";
import { labCopy } from "@/lib/lab3d/experiment-copy";
import PerfProbe, { type PerfSample } from "./PerfProbe";
import { useSceneDrag } from "./useSceneDrag";

const COPY = labCopy("E12");

const RES = 96;
/** 概率本身只有 0~1，摆到 3D 里太扁；统一放大，玻璃面也跟着放大同一倍。 */
const HEIGHT_SCALE = 2.2;
const GLASS_Y = 0.5 * HEIGHT_SCALE;
/** 往下拖 mouseY 增大 → lift 减小。一格像素抬升多少。 */
const DRAG_SENSITIVITY = 0.006;
/** 高到多少才重算顶点法线（O(1.8 万) 一次，逐帧算纯属浪费）。 */
const APPLY_EPS = 0.004;

const LOW_COLOR = new THREE.Color("#0b2742");
const HIGH_COLOR = new THREE.Color("#9df0ff");
const RIDGE_COLOR = new THREE.Color("#ffd166");

type TerrainProps = {
  liftRef: React.MutableRefObject<number>;
  onLiftChange: (next: number) => void;
};

function buildTerrain() {
  const h0 = gridHeights(0, RES);
  const h1 = gridHeights(1, RES);
  const count = (RES + 1) * (RES + 1);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let iz = 0; iz <= RES; iz += 1) {
    for (let ix = 0; ix <= RES; ix += 1) {
      const i = iz * (RES + 1) + ix;
      positions[i * 3] = (ix / RES - 0.5) * 2 * DOMAIN;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = (iz / RES - 0.5) * 2 * DOMAIN;
    }
  }

  const indices: number[] = [];
  for (let iz = 0; iz < RES; iz += 1) {
    for (let ix = 0; ix < RES; ix += 1) {
      const a = iz * (RES + 1) + ix;
      const b = a + 1;
      const c = a + (RES + 1);
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return { geometry, h0, h1 };
}

/** 高度 → 顶点色：碗底暗、山顶亮，0.5 附近抹一道暖色让决策边界自己会发光。 */
function shade(height: number, target: THREE.Color) {
  const ridge = 1 - Math.min(1, Math.abs(height - 0.5) / 0.12);
  target.copy(LOW_COLOR).lerp(HIGH_COLOR, height);
  if (ridge > 0) target.lerp(RIDGE_COLOR, ridge * 0.5);
  return target;
}

function Terrain({ liftRef, onLiftChange }: TerrainProps) {
  const { geometry, h0, h1 } = useMemo(buildTerrain, []);
  const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
  const colAttr = geometry.getAttribute("color") as THREE.BufferAttribute;
  const scratch = useMemo(() => new THREE.Color(), []);
  const applied = useRef(-1);

  const apply = useCallback(
    (lift: number) => {
      const p = posAttr.array as Float32Array;
      const c = colAttr.array as Float32Array;
      for (let i = 0; i < h0.length; i += 1) {
        const height = h0[i] + (h1[i] - h0[i]) * lift;
        p[i * 3 + 1] = height * HEIGHT_SCALE;
        shade(height, scratch).toArray(c, i * 3);
      }
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      geometry.computeVertexNormals();
    },
    [colAttr, geometry, h0, h1, posAttr, scratch],
  );

  /* 平滑追踪 liftRef：拖拽手感靠这个,而不是拖多快跳多快。 */
  useFrame((_, delta) => {
    const target = liftRef.current;
    if (Math.abs(target - applied.current) < APPLY_EPS) return;
    applied.current += (target - applied.current) * Math.min(1, delta * 12);
    if (Math.abs(target - applied.current) < APPLY_EPS) applied.current = target;
    apply(applied.current);
  });

  /* 拖地形 = 改 lift；空白处拖 = OrbitControls 转视角。
     两者的冲突（stopPropagation 拦不住 OrbitControls）由 useSceneDrag 统一处理。 */
  const drag = useSceneDrag({
    onDrag: (_dx, dy) => {
      const next = Math.min(1, Math.max(0, liftRef.current - dy * DRAG_SENSITIVITY));
      liftRef.current = next;
      onLiftChange(next);
    },
  });

  return (
    <>
      <mesh {...drag.handlers} geometry={geometry}>
        <meshStandardMaterial vertexColors roughness={0.86} side={THREE.DoubleSide} />
      </mesh>
      {/* 同一份几何叠一层线框，玻璃面切到地形的交线才读得出来 */}
      <mesh geometry={geometry} raycast={() => null}>
        <meshBasicMaterial
          vertexColors
          wireframe
          transparent
          opacity={0.12}
          depthWrite={false}
        />
      </mesh>
      <OrbitControls ref={drag.attach} makeDefault enablePan={false} />
    </>
  );
}

/** 分类面停死在 0.5 概率处：地形穿出来的一刹那，就是判 1 的区域。 */
function GlassDecisionPlane() {
  return (
    <mesh position={[0, GLASS_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <planeGeometry args={[DOMAIN * 2.3, DOMAIN * 2.3, 1, 1]} />
      <MeshTransmissionMaterial
        transmission={1}
        thickness={0.55}
        roughness={0.1}
        chromaticAberration={0.4}
        anisotropicBlur={0.35}
        distortion={0.28}
        distortionScale={0.4}
        temporalDistortion={0.06}
        ior={1.35}
        samples={6}
        resolution={512}
        background={new THREE.Color("#08131f")}
      />
    </mesh>
  );
}

function DataPoints({ liftRef }: { liftRef: React.MutableRefObject<number> }) {
  const group = useRef<THREE.Group>(null);
  const mlp = useMemo(() => trainXorMlp(), []);
  const lifts = useMemo(() => new Float32Array(DATA_POINTS.length), []);

  useFrame(() => {
    const nodes = group.current?.children ?? [];
    const liftNow = liftRef.current;
    /* 数据点的「亮起来」随 lift 走：压平时几乎不发光的四个小球，拉起时越拉越亮、略微胀大，
       拖拽的过程中能直接感到非线性表示被灌进这个空间了。 */
    const glow = 2.4 * (0.35 + 1.15 * liftNow);
    const radius = 1 + 0.28 * liftNow;

    DATA_POINTS.forEach((point, i) => {
      const height = heightAt([point.x, point.z], liftNow, mlp);
      /* 每个球按自己那条曲线走：class 1 的两个点升、class 0 的两个点降，
         肉眼就能看见它们穿过玻璃面换到另一侧。 */
      lifts[i] += (height - lifts[i]) * 0.18;
      const node = nodes[i] as THREE.Mesh | undefined;
      if (!node) return;
      node.position.y = lifts[i] * HEIGHT_SCALE;
      node.scale.setScalar(radius);
      const material = node.material as THREE.MeshStandardMaterial;
      material.emissiveIntensity = glow;
    });
  });

  return (
    <group ref={group}>
      {DATA_POINTS.map((point, i) => (
        <mesh key={i} position={[point.x, 0, point.z]} raycast={() => null}>
          <sphereGeometry args={[0.1, 20, 20]} />
          <meshStandardMaterial
            color={point.label === 1 ? "#7dffd0" : "#ffb86b"}
            emissive={point.label === 1 ? "#2fe0a0" : "#ff8a2b"}
            emissiveIntensity={2.4}
            roughness={0.35}
          />
        </mesh>
      ))}
    </group>
  );
}

export default function XorFoldScene() {
  const liftRef = useRef(0.5);
  const [lift, setLiftState] = useState(0.5);
  const [perf, setPerf] = useState<PerfSample>({ fps: 0, calls: 0, tris: 0 });
  const [degraded, setDegraded] = useState(false);

  const setLift = useCallback((next: number) => {
    const clamped = Math.min(1, Math.max(0, next));
    liftRef.current = clamped;
    setLiftState(clamped);
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 0.2 : 0.05;
    if (event.key === "ArrowUp" || event.key === "PageUp") setLift(liftRef.current + step);
    else if (event.key === "ArrowDown" || event.key === "PageDown") setLift(liftRef.current - step);
    else if (event.key === "Home") setLift(0);
    else if (event.key === "End") setLift(1);
    else return;
    event.preventDefault();
  };

  const accuracy = accuracyAt(lift);

  return (
    <div className="min-h-screen bg-[#010204] text-[#dff6ff]">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-cyan-100/10 px-5 py-4">
        <div className="min-w-0">
          <p className="text-[10px] tracking-[0.2em] text-cyan-200/50">
            R3F · {COPY.code} · 空间折叠
          </p>
          <h1 className="text-lg font-semibold">{COPY.title}</h1>
          <p className="text-xs text-cyan-100/50">{COPY.source}</p>
        </div>
        <dl className="flex flex-wrap gap-5 text-[11px] font-mono">
          {[
            ["lift 拉起程度", `${(lift * 100).toFixed(0)}%`],
            ["训练准确率", `${(accuracy * 100).toFixed(0)}%`],
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
        aria-label="XOR 空间折叠三维场景。上下拖拽地形改变 lift，方向键微调。"
        onKeyDown={onKeyDown}
      >
        <Canvas
          dpr={[1, 2]}
          camera={{ position: [4.4, 3.4, 5.2], fov: 44 }}
          gl={{ antialias: true }}
        >
          <color attach="background" args={["#010204"]} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[5, 9, 4]} intensity={1.15} />
          <pointLight position={[-4, 3, -4]} intensity={18} color="#69d8ff" />
          <Suspense fallback={null}>
            <Terrain liftRef={liftRef} onLiftChange={setLift} />
            <DataPoints liftRef={liftRef} />
            <GlassDecisionPlane />
            <EffectComposer>
              <Bloom
                mipmapBlur
                intensity={0.85}
                luminanceThreshold={0.55}
                luminanceSmoothing={0.22}
              />
            </EffectComposer>
            <PerformanceMonitor
              onDecline={() => setDegraded(true)}
              onFallback={() => setDegraded(true)}
            />
            {degraded ? <AdaptiveDpr pixelated /> : null}
            <PerfProbe onSample={setPerf} />
          </Suspense>
        </Canvas>
      </div>

      <div className="px-5 py-4 text-xs leading-relaxed">
        <p className="text-cyan-100/70">
          <b className="text-cyan-50">怎么玩：</b>在<b>地形上</b>按住上下拖 = 把隐藏层的非线性表示
          「拉」进这个空间（↑ 拉起 / ↓ 压平）；在<b>空白处</b>拖 = 转视角；滚轮缩放；
          地形聚焦后用 ↑/↓ 微调、Home/End 到两端。
        </p>
        <p className="mt-2 text-cyan-100/55">
          那块玻璃是 <code className="text-cyan-200/80">P(1|x) = 0.5</code> 的分类面。
          lift = 0 时曲面只是一道斜坡，一条直线切不开 XOR，准确率封顶{" "}
          <b>{(accuracyAt(0) * 100).toFixed(0)}%</b>；拉满时曲面长出两座山，
          山尖穿出玻璃的两块就是被判为 1 的区域，准确率{" "}
          <b>{(accuracyAt(1) * 100).toFixed(0)}%</b>。
        </p>
        <p className="mt-2 text-cyan-100/40">{COPY.acceptance}</p>
        <p className="mt-1 text-cyan-100/40">
          结论：{COPY.conclusion}
        </p>
        {degraded ? (
          <p className="mt-2 text-amber-300/70">
            帧率偏低，已自动降低渲染分辨率（AdaptiveDpr）。玻璃材质的 backside 缓冲与 Bloom
            是多出来的开销，可再调 samples / resolution。
          </p>
        ) : null}
      </div>
    </div>
  );
}
