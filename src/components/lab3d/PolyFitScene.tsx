"use client";

/* E04「多项式阶数看过拟合与欠拟合」的 3D 沉浸式版本：一条会形变的拟合带 + 一面误差墙。
 *
 * 交互只有两件事：在拟合带上按住上下拖 = 改多项式阶数（1..12），空白处拖 = 转视角。
 * 阶数本身是整数，但拖拽是连续量 degFloat：拟合带在 floor/ceil 两个整数解之间插值，
 * 于是「平滑 → 扭曲 → 过拟合」是一次连续的形变，而不是一格一格地跳。
 * 墙上的两条 U 形曲线（训练 / 测试 RMSE）和沿墙滑动的亮点，把「找拐点」这件事
 * 从表格里搬进了场景里 —— 拖到谷底那一下，就是最优容量。
 *
 * 数学一律来自 src/lib/lab3d/poly-fit.ts（已和静态页 exp-e04.js 原文逐位对拍），
 * 这个文件只负责「把数字摆进空间」和「把空间里的点换算回显示」。
 */

import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { AdaptiveDpr, Line, OrbitControls, PerformanceMonitor } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import { damp, damp3 } from "maath/easing";
import {
  DEGREE_MAX,
  DEGREE_MIN,
  TEST_N,
  type FitResult,
  errorSweep,
  evalPoly,
  fitAt,
  makeDataset,
} from "@/lib/lab3d/poly-fit";
import { labCopy } from "@/lib/lab3d/experiment-copy";
import PerfProbe, { type PerfSample } from "./PerfProbe";
import { useSceneDrag } from "./useSceneDrag";

const COPY = labCopy("E04");

/** 数据 x ∈ [−1.05, 1.05] 摆到世界 X 上的放大倍数。 */
const X_SCALE = 1.7;
/**
 * 显示高度的软限幅上限。deg=12 的曲线在区间边缘能冲到 |y| ≈ 41（龙格现象），
 * 硬截断会拍成一块平板、把「爆冲」这件事糊掉；tanh 保次序又保有限。
 */
const Y_LIMIT = 2.6;
const SAMPLES = 120;
const RIBBON_HALF_W = 0.5;
/** 误差墙立在数据后面（z 负方向），当背景板用，不挡镜头。 */
const WALL_Z = -2.05;
const WALL_BASE_Y = 0.72;
const RMSE_TO_Y = 3.2;
const WALL_X0 = -2.2;
const WALL_X1 = 2.2;
/** 一阶 / 46px —— 和静态页滑条一格等价的手感。 */
const DRAG_DEG_PER_PX = 1 / 46;
/** 高到多少才重算带子顶点（约 1/250 阶，肉眼无感，省下大量空转）。 */
const APPLY_EPS = 0.004;

const FLAT_COLOR = new THREE.Color("#38bdf8");
const HOT_COLOR = new THREE.Color("#ff7b54");

/* 数据与拟合都是定种子的纯函数，模块级算一次即可（12 个阶数的正规方程，微秒级）。 */
const DATASET = makeDataset();
const FITS: FitResult[] = [];
for (let d = 0; d <= DEGREE_MAX; d += 1) FITS[d] = fitAt(d, DATASET);
const SWEEP = errorSweep(DATASET, DEGREE_MAX);

function toWorldY(value: number): number {
  return Y_LIMIT * Math.tanh(value / Y_LIMIT);
}

function wallX(degree: number): number {
  const t = (degree - DEGREE_MIN) / (DEGREE_MAX - DEGREE_MIN);
  return WALL_X0 + (WALL_X1 - WALL_X0) * t;
}

function rmseY(value: number): number {
  return WALL_BASE_Y + value * RMSE_TO_Y;
}

/** 连续阶数下插值某个整数阶指标（墙上亮点沿曲线滑动用）。 */
function sweepAt(degree: number, key: "trainRmse" | "testRmse"): number {
  const lo = Math.min(DEGREE_MAX, Math.max(DEGREE_MIN, Math.floor(degree)));
  const hi = Math.min(DEGREE_MAX, lo + 1);
  const t = Math.min(1, Math.max(0, degree - lo));
  return FITS[lo][key] * (1 - t) + FITS[hi][key] * t;
}

type SceneProps = {
  degRef: React.MutableRefObject<number>;
  onDegChange: (next: number) => void;
};

function buildRibbon() {
  const count = (SAMPLES + 1) * 2;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const xs = new Float32Array(SAMPLES + 1);
  const truth = new Float32Array(SAMPLES + 1);

  for (let i = 0; i <= SAMPLES; i += 1) {
    const x = -1.05 + (2.1 * i) / SAMPLES;
    xs[i] = x;
    truth[i] = Math.sin(Math.PI * x);
    const wx = x * X_SCALE;
    for (let r = 0; r < 2; r += 1) {
      const v = i * 2 + r;
      positions[v * 3] = wx;
      positions[v * 3 + 2] = r === 0 ? -RIBBON_HALF_W : RIBBON_HALF_W;
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const a = i * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return { geometry, xs, truth };
}

function FitRibbon({ degRef, onDegChange }: SceneProps) {
  const { geometry, xs, truth } = useMemo(buildRibbon, []);
  const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
  const colAttr = geometry.getAttribute("color") as THREE.BufferAttribute;
  const scratch = useMemo(() => new THREE.Color(), []);
  /* maath 的 damp 是「对象 + 键名」的形式，所以形变状态放在一个普通对象里，
     而不是 ref 的数字上（MutableRefObject 没有索引签名，塞不进去）。
     初值取 1 阶而不是 9 阶：载入后第一帧就会有一次真实的 apply（几何不会停在压平的初始态），
     顺便变成一段「容量从小拉大」的入场动画。 */
  const morph = useRef({ deg: DEGREE_MIN });

  const apply = useCallback(
    (degFloat: number) => {
      const p = posAttr.array as Float32Array;
      const c = colAttr.array as Float32Array;
      const lo = Math.min(DEGREE_MAX, Math.max(DEGREE_MIN, Math.floor(degFloat)));
      const hi = Math.min(DEGREE_MAX, lo + 1);
      const t = Math.min(1, Math.max(0, degFloat - lo));
      const wLo = FITS[lo].weights;
      const wHi = FITS[hi].weights;

      for (let i = 0; i <= SAMPLES; i += 1) {
        const x = xs[i];
        const height = evalPoly(wLo, x) * (1 - t) + evalPoly(wHi, x) * t;
        const y = toWorldY(height);
        /* 离真实 sin(πx) 越远越往暖色走：过拟合时那些冲上天的摆动自己会烧起来。 */
        const dev = Math.min(1, Math.abs(height - truth[i]) / 1.1);
        scratch.copy(FLAT_COLOR).lerp(HOT_COLOR, dev);
        for (let r = 0; r < 2; r += 1) {
          const v = i * 2 + r;
          p[v * 3 + 1] = y;
          scratch.toArray(c, v * 3);
        }
      }
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      geometry.computeVertexNormals();
    },
    [colAttr, geometry, posAttr, scratch, truth, xs],
  );

  useFrame((_, delta) => {
    const target = degRef.current;
    if (Math.abs(target - morph.current.deg) < APPLY_EPS) return;
    damp(morph.current, "deg", target, 0.13, delta);
    if (Math.abs(target - morph.current.deg) < APPLY_EPS) morph.current.deg = target;
    apply(morph.current.deg);
  });

  /* 带子本身太细不好抓，同一组 handler 再挂一张盖住数据区的隐形抓取板。 */
  const drag = useSceneDrag({
    onDrag: (_dx, dy) => {
      onDegChange(degRef.current - dy * DRAG_DEG_PER_PX);
    },
  });

  return (
    <>
      <mesh {...drag.handlers} geometry={geometry}>
        <meshStandardMaterial vertexColors roughness={0.5} metalness={0.1} side={THREE.DoubleSide} />
      </mesh>
      {/* 同一份几何叠线框，摆动变成「笼子」还是「山」一眼分得清 */}
      <mesh geometry={geometry} raycast={() => null}>
        <meshBasicMaterial vertexColors wireframe transparent opacity={0.16} depthWrite={false} />
      </mesh>
      <mesh
        {...drag.handlers}
        position={[0, toWorldY(1.2), RIBBON_HALF_W + 0.25]}
        visible={false}
      >
        <planeGeometry args={[2.1 * X_SCALE, 3.4, 1, 1]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <OrbitControls ref={drag.attach} makeDefault enablePan={false} target={[0, 0.7, -0.6]} />
    </>
  );
}

/** 真实 sin(πx)：暗灰虚线，是「应该拟合成什么样」的那把尺。 */
function TruthCurve() {
  const points = useMemo(() => {
    const out: [number, number, number][] = [];
    for (let i = 0; i <= 120; i += 1) {
      const x = -1.05 + (2.1 * i) / 120;
      out.push([x * X_SCALE, toWorldY(Math.sin(Math.PI * x)), 0]);
    }
    return out;
  }, []);
  return (
    <Line points={points} color="#7d98ad" lineWidth={1.6} dashed dashSize={0.12} gapSize={0.08} raycast={() => null} />
  );
}

function DataPoints() {
  return (
    <group>
      {DATASET.train.map(([x, y], i) => (
        <mesh key={`t${i}`} position={[x * X_SCALE, toWorldY(y), 0]} raycast={() => null}>
          <sphereGeometry args={[0.075, 20, 20]} />
          <meshStandardMaterial color="#d8f3ff" emissive="#4cc2ff" emissiveIntensity={2.4} roughness={0.3} />
        </mesh>
      ))}
      {DATASET.test.map(([x, y], i) => (
        <mesh key={`e${i}`} position={[x * X_SCALE, toWorldY(y), 0]} raycast={() => null}>
          <sphereGeometry args={[0.05, 14, 14]} />
          <meshStandardMaterial color="#e6d3ff" emissive="#a78bfa" emissiveIntensity={1.1} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

/** 误差墙：deg 1..12 的两条 RMSE 曲线 + 沿曲线滑动的亮点。 */
function ErrorWall({ degRef }: { degRef: React.MutableRefObject<number> }) {
  const marker = useRef<THREE.Group>(null);
  const markerPos = useMemo(
    () => new THREE.Vector3(wallX(DEGREE_MIN), rmseY(FITS[DEGREE_MIN].testRmse), WALL_Z + 0.08),
    [],
  );
  const markerTarget = useMemo(() => new THREE.Vector3(), []);

  const trainCurve = useMemo(
    () => SWEEP.map((f) => [wallX(f.degree), rmseY(f.trainRmse), WALL_Z] as [number, number, number]),
    [],
  );
  const testCurve = useMemo(
    () => SWEEP.map((f) => [wallX(f.degree), rmseY(f.testRmse), WALL_Z] as [number, number, number]),
    [],
  );
  const ticks = useMemo(() => {
    const arr: number[] = [];
    for (const f of SWEEP) {
      arr.push(wallX(f.degree), rmseY(0) - 0.08, WALL_Z, wallX(f.degree), rmseY(0) + 0.04, WALL_Z);
    }
    return new Float32Array(arr);
  }, []);

  useFrame((_, delta) => {
    const degree = degRef.current;
    markerTarget.set(wallX(degree), rmseY(sweepAt(degree, "testRmse")), WALL_Z + 0.08);
    damp3(markerPos, markerTarget, 0.16, delta);
    const node = marker.current;
    if (node) node.position.copy(markerPos);
  });

  return (
    <group>
      {/* 背板 */}
      <mesh position={[(WALL_X0 + WALL_X1) / 2, (WALL_BASE_Y + rmseY(0.6)) / 2, WALL_Z - 0.03]} raycast={() => null}>
        <planeGeometry args={[WALL_X1 - WALL_X0 + 0.5, rmseY(0.6) - WALL_BASE_Y + 0.7, 1, 1]} />
        <meshBasicMaterial color="#061320" transparent opacity={0.55} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {/* RMSE = 0 的基线 */}
      <Line
        points={[
          [WALL_X0 - 0.15, rmseY(0), WALL_Z],
          [WALL_X1 + 0.15, rmseY(0), WALL_Z],
        ]}
        color="#2b6a8c"
        lineWidth={1.2}
        raycast={() => null}
      />
      <lineSegments raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[ticks, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#2b6a8c" transparent opacity={0.7} />
      </lineSegments>
      <Line points={trainCurve} color="#7dffd0" lineWidth={2.4} raycast={() => null} />
      <Line points={testCurve} color="#ffd166" lineWidth={2.4} raycast={() => null} />
      <group ref={marker}>
        <mesh raycast={() => null}>
          <sphereGeometry args={[0.09, 20, 20]} />
          <meshStandardMaterial color="#fff3cf" emissive="#ffd166" emissiveIntensity={3.4} roughness={0.25} />
        </mesh>
      </group>
    </group>
  );
}

export default function PolyFitScene() {
  const degRef = useRef(9);
  const [deg, setDegState] = useState(9);
  const [perf, setPerf] = useState<PerfSample>({ fps: 0, calls: 0, tris: 0 });
  const [degraded, setDegraded] = useState(false);

  const setDeg = useCallback((next: number) => {
    const clamped = Math.min(DEGREE_MAX, Math.max(DEGREE_MIN, next));
    degRef.current = clamped;
    /* 指标读的是「当前生效的整数阶」：阶数本来就是整数，拖拽只是在两个整数解之间过渡。 */
    setDegState(Math.min(DEGREE_MAX, Math.max(DEGREE_MIN, Math.round(clamped))));
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 0.25 : 1;
    if (event.key === "ArrowUp" || event.key === "PageUp") setDeg(degRef.current + step);
    else if (event.key === "ArrowDown" || event.key === "PageDown") setDeg(degRef.current - step);
    else if (event.key === "Home") setDeg(DEGREE_MIN);
    else if (event.key === "End") setDeg(DEGREE_MAX);
    else return;
    event.preventDefault();
  };

  const active = FITS[deg];
  const best = SWEEP.reduce((bi, f) => (f.testRmse < bi.testRmse ? f : bi), SWEEP[0]);

  return (
    <div className="min-h-screen bg-[#010204] text-[#dff6ff]">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-cyan-100/10 px-5 py-4">
        <div className="min-w-0">
          <p className="text-[10px] tracking-[0.2em] text-cyan-200/50">
            R3F · {COPY.code} · 拟合带与误差墙
          </p>
          <h1 className="text-lg font-semibold">{COPY.title}</h1>
          <p className="text-xs text-cyan-100/50">{COPY.source}</p>
        </div>
        <dl className="flex flex-wrap gap-5 text-[11px] font-mono">
          {[
            ["多项式阶数", String(active.degree)],
            ["训练 RMSE", active.trainRmse.toFixed(4)],
            ["测试 RMSE", active.testRmse.toFixed(4)],
            ["泛化差距", `${active.gap >= 0 ? "+" : ""}${active.gap.toFixed(4)}`],
            ["参数个数", String(active.params)],
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
        aria-label="多项式拟合三维场景。在拟合带上上下拖拽改变阶数，方向键微调。"
        onKeyDown={onKeyDown}
      >
        <Canvas dpr={[1, 2]} camera={{ position: [3.1, 2.7, 6.3], fov: 45 }} gl={{ antialias: true }}>
          <color attach="background" args={["#010204"]} />
          <ambientLight intensity={0.55} />
          <directionalLight position={[5, 9, 4]} intensity={1.1} />
          <pointLight position={[-4, 3, 2]} intensity={16} color="#69d8ff" />
          <Suspense fallback={null}>
            <FitRibbon degRef={degRef} onDegChange={setDeg} />
            <DataPoints />
            <TruthCurve />
            <ErrorWall degRef={degRef} />
            <EffectComposer>
              <Bloom mipmapBlur intensity={0.7} luminanceThreshold={0.6} luminanceSmoothing={0.22} />
            </EffectComposer>
            <PerformanceMonitor onDecline={() => setDegraded(true)} onFallback={() => setDegraded(true)} />
            {degraded ? <AdaptiveDpr pixelated /> : null}
            <PerfProbe onSample={setPerf} />
          </Suspense>
        </Canvas>
      </div>

      <div className="px-5 py-4 text-xs leading-relaxed">
        <p className="text-cyan-100/70">
          <b className="text-cyan-50">怎么玩：</b>在<b>拟合带（或它前面那块区域）</b>按住上下拖 = 改阶数
          （↑ 加阶 / ↓ 减阶，约 46px 一阶）；在<b>空白处</b>拖 = 转视角；滚轮缩放；场景聚焦后 ↑/↓ 走一阶、
          Shift+↑/↓ 走 0.25 阶、Home/End 到 1 阶与 12 阶。
        </p>
        <p className="mt-2 text-cyan-100/55">
          亮的 16 颗是训练点、暗的 {TEST_N} 颗是测试点，灰虚线是真实的 <code className="text-cyan-200/80">sin(πx)</code>。
          带子离真值越远越往橙红烧。后面那面墙的绿线是训练 RMSE、黄线是测试 RMSE，黄点跟着你拖的阶数沿墙滑动 ——{" "}
          <b>
            谷底在 deg={best.degree}（测试 RMSE {best.testRmse.toFixed(4)}）
          </b>
          ，那就是这份数据的最优容量。
        </p>
        <p className="mt-2 text-cyan-100/40">
          显示口径：带子高度做了软限幅（<code>2.6·tanh(y/2.6)</code>），deg=12 在区间边缘的龙格爆冲真实值到 |y|≈41，
          画出来是「顶到天花板」而不是冲出画面；墙上的 RMSE 数字没有经过这个变换，和 HUD、静态页完全一致。
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
