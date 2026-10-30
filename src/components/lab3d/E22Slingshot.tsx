"use client";

/* E22「学习率敏感性扫描」的沉浸版：重力场 + 弹弓甩球。
 *
 * 交互只有一件事：按住能量球往后拉、松手发射。拖拽向量按
 *   lr = −(d·∇f) / |∇f|²
 * 精确反解成学习率（见 src/lib/lab3d/lr-surface.ts），之后严格按真梯度下降积分 ——
 * 所以「甩多狠」直接就是「步长多大」，不是给物理抛物套了层皮。
 *
 * 视觉上地形是手写 GLSL 的波纹发光面，球带 maath 阻尼惯性 + drei Trail 拖尾。
 */

import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { AdaptiveDpr, Line, OrbitControls, PerformanceMonitor, Trail } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { damp3 } from "maath/easing";
import * as THREE from "three";
import {
  A,
  B,
  LR_STABILITY,
  OUTCOME_LABEL,
  START,
  classify,
  gradient,
  learningRateFromDrag,
  loss,
  simulate,
  type Outcome,
  type Run,
  type Vec2,
} from "@/lib/lab3d/lr-surface";
import { labCopy } from "@/lib/lab3d/experiment-copy";
import PerfProbe, { type PerfSample } from "./PerfProbe";
import { useSceneDrag } from "./useSceneDrag";

const COPY = labCopy("E22");

const TERRAIN_X = 3.2;
const TERRAIN_Z = 6.2;
const GRID = 96;
/** 像素拖拽 → 世界位移。按 x₀ 处 |∇f|≈0.944、|∇f|²≈0.891 反推：
 *  约 220px 的下坡拖拽 ≈ 稳定上限 5.7143，正好把「边界」放在手腕够得到的地方。 */
const DRAG_GAIN = 0.0245;
const BALL_LIFT = 0.09;
const STEPS_PER_SEC = 9;

const worldOf = ([x, z]: Vec2): [number, number, number] => [x, loss([x, z]) + BALL_LIFT, z];
const nowSec = () => performance.now() / 1000;

/* ── 波纹地形 ─────────────────────────────────────────────── */

const VERT = /* glsl */ `
  uniform float uTime;
  varying float vH;
  varying float vR;
  void main() {
    vec3 p = position;
    float r = length(p.xz);
    float ripple = sin(r * 5.5 - uTime * 2.6) * 0.055 * exp(-r * 0.22);
    p.y += ripple;
    vH = clamp(p.y / 2.5, 0.0, 1.0);
    vR = r;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform float uTime;
  varying float vH;
  varying float vR;
  void main() {
    float h = clamp(vH, 0.0, 1.0);
    vec3 base = mix(vec3(0.02, 0.09, 0.17), vec3(0.55, 0.90, 1.00), h);
    // 高处偏红：靠近发散区的地形自己会“发烫”。用乘法而不是 pow，避开 pow(0.0, y) 的 NaN
    base += vec3(1.0, 0.35, 0.30) * h * h * h * h * 0.45;
    float rings = 0.5 + 0.5 * sin(vR * 5.5 - uTime * 2.6);
    base += vec3(0.55, 0.90, 1.00) * rings * 0.06;
    gl_FragColor = vec4(base, 1.0);
  }
`;

function RippleTerrain() {
  /* 用命令式构造而不是 <shaderMaterial> 元素：材质属性在 R3F 里是构造后赋值的，
     对 ShaderMaterial 这种「构造期就要 uniforms」的类型容易踩坑，直接 new 出来最省事。 */
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { uTime: { value: 0 } },
        side: THREE.DoubleSide,
      }),
    [],
  );

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(TERRAIN_X * 2, TERRAIN_Z * 2, GRID, GRID);
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    /* 平面默认躺在 XY、y 是"向上"，这里转成 XZ 平面并把 y 填成 LOSS 真值 */
    for (let i = 0; i < arr.length; i += 3) {
      const x = arr[i];
      const z = -arr[i + 1];
      arr[i] = x;
      arr[i + 1] = loss([x, z]);
      arr[i + 2] = z;
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }, []);

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh geometry={geometry} raycast={() => null}>
      {/* 重排到 XZ 时绕向被翻了，材质里已经设 DoubleSide */}
      <primitive object={material} attach="material" />
    </mesh>
  );
}

/* ── 能量球（自带拖尾） ───────────────────────────────────── */

type BallProps = {
  runRef: React.MutableRefObject<{ run: Run | null; startAt: number }>;
  onDragWorld: (dragWorld: Vec2) => void;
  onTick: (step: number) => void;
};

function EnergyBall({ runRef, onDragWorld, onTick }: BallProps) {
  const ball = useRef<THREE.Mesh>(null);
  const anchor = useRef<THREE.Vector3 | null>(null);
  const target = useMemo(() => new THREE.Vector3(...worldOf(START)), []);
  const home = useMemo(() => new THREE.Vector3(...worldOf(START)), []);
  const lastStep = useRef(-1);

  /* 球所在高度的水平面：把屏幕射线落成世界坐标（normal·p + constant = 0） */
  const plane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 1, 0), -(loss(START) + BALL_LIFT)),
    [],
  );
  const hit = useMemo(() => new THREE.Vector3(), []);

  const drag = useSceneDrag({
    onDrag: (_dx, _dy, event) => {
      if (!event.ray.intersectPlane(plane, hit)) return;
      if (!anchor.current) anchor.current = hit.clone();
      onDragWorld([hit.x - anchor.current.x, hit.z - anchor.current.z]);
    },
    onEnd: () => {
      /* 松手不清 anchor：发射逻辑要用它算最终位移，由父层在 launch 后重置 */
    },
  });

  useFrame((_, delta) => {
    const mesh = ball.current;
    if (!mesh) return;

    const { run, startAt } = runRef.current;
    if (run) {
      const elapsed = nowSec() - startAt;
      const index = Math.min(run.points.length - 1, Math.floor(elapsed * STEPS_PER_SEC));
      target.set(...worldOf(run.points[index]));
      if (index !== lastStep.current) {
        lastStep.current = index;
        onTick(index);
      }
    } else if (!drag.isDragging.current) {
      target.copy(home);
    }

    /* 惯性：球是「被阻尼拖过去」的，不是逐帧瞬移 */
    damp3(mesh.position, target, 0.16, delta);
  });

  return (
    /* 不传 target：drei 的 Trail 会自己按 ref.current.children 找第一个子对象，
       球仍然是我们手里那个受控 mesh（ref 不变），也避开了 target 的 ref 类型过严问题。 */
    <Trail width={2.4} length={5} color="#ffd166" decay={1.4}>
      <mesh ref={ball} position={worldOf(START)} {...drag.handlers}>
        <sphereGeometry args={[0.13, 24, 24]} />
        <meshStandardMaterial color="#fff6d8" emissive="#ffd166" emissiveIntensity={2.6} roughness={0.28} />
      </mesh>
    </Trail>
  );
}

/* ── 主组件 ───────────────────────────────────────────────── */

export default function E22Slingshot() {
  const [perf, setPerf] = useState<PerfSample>({ fps: 0, calls: 0, tris: 0 });
  const [degraded, setDegraded] = useState(false);
  const [lr, setLr] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [step, setStep] = useState(0);
  const [total, setTotal] = useState(0);
  const [ghosts, setGhosts] = useState<{ lr: number; points: Vec2[] }[]>([]);

  const runRef = useRef<{ run: Run | null; startAt: number }>({ run: null, startAt: 0 });
  const dragWorldRef = useRef<Vec2>([0, 0]);

  const g0 = useMemo(() => gradient(START), []);

  const onDragWorld = useCallback((dragWorld: Vec2) => {
    dragWorldRef.current = dragWorld;
    setLr(learningRateFromDrag(START, dragWorld));
  }, []);

  const onTick = useCallback((index: number) => setStep(index), []);

  const launch = useCallback(() => {
    const dragWorld = dragWorldRef.current;
    if (Math.hypot(dragWorld[0], dragWorld[1]) < 0.12) return;

    const nextLr = learningRateFromDrag(START, dragWorld);
    const run = simulate(nextLr);
    runRef.current = { run, startAt: nowSec() };
    setLr(nextLr);
    setOutcome(classify(nextLr));
    setStep(0);
    setTotal(run.points.length);
    setGhosts((prev) => [{ lr: nextLr, points: run.points }, ...prev].slice(0, 3));
    /* 一次发射只消耗一次拖拽向量，否则按 Enter 会反复重放飞同一个 */
    dragWorldRef.current = [0, 0];
  }, []);

  const resetBall = useCallback(() => {
    runRef.current = { run: null, startAt: 0 };
    setStep(0);
    setTotal(0);
    setOutcome(null);
    setLr(0);
    dragWorldRef.current = [0, 0];
  }, []);


  return (
    <div className="min-h-screen bg-[#010204] text-[#dff6ff]">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-cyan-100/10 px-5 py-4">
        <div className="min-w-0">
          <p className="text-[10px] tracking-[0.2em] text-cyan-200/50">R3F · {COPY.code} · 弹弓 × 重力场</p>
          <h1 className="text-lg font-semibold">{COPY.title}</h1>
          <p className="text-xs text-cyan-100/50">{COPY.source}</p>
        </div>
        <dl className="flex flex-wrap gap-5 text-[11px] font-mono">
          {[
            ["本次 lr", lr.toFixed(2)],
            ["稳定上限", LR_STABILITY.toFixed(2)],
            ["|∇f(x₀)|", Math.hypot(g0[0], g0[1]).toFixed(3)],
            ["结局", outcome ? OUTCOME_LABEL[outcome] : "—"],
            ["步数", total ? `${step}/${total}` : "—"],
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
        className="h-[min(72vh,720px)] w-full outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60"
        tabIndex={0}
        role="application"
        aria-label="学习率弹弓场景。按住能量球向后拖拽并松手发射，或按回车发射。"
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            launch();
          }
        }}
      >
        <Canvas dpr={[1, 2]} camera={{ position: [6.4, 6.4, 9.2], fov: 44 }} gl={{ antialias: true }}>
          <color attach="background" args={["#010204"]} />
          <ambientLight intensity={0.45} />
          <directionalLight position={[6, 10, 4]} intensity={1.0} />
          <Suspense fallback={null}>
            <RippleTerrain />

            {/* 最近 3 次发射的幽灵轨迹：直接看出「这次甩得太猛/太轻」 */}
            {ghosts.map((ghost, index) => (
              <Line
                key={`${ghost.lr.toFixed(3)}-${index}`}
                points={ghost.points.map(worldOf)}
                color={index === 0 ? "#ffd166" : "#5d7fa8"}
                lineWidth={index === 0 ? 2.4 : 1.2}
                transparent
                opacity={index === 0 ? 1 : Math.max(0.15, 0.45 - index * 0.12)}
              />
            ))}

            <EnergyBall runRef={runRef} onDragWorld={onDragWorld} onTick={onTick} />

            <EffectComposer>
              <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.45} luminanceSmoothing={0.2} />
            </EffectComposer>
            <PerformanceMonitor onDecline={() => setDegraded(true)} onFallback={() => setDegraded(true)} />
            {degraded ? <AdaptiveDpr pixelated /> : null}
            <PerfProbe onSample={setPerf} />
            <OrbitControls makeDefault enablePan={false} enableDamping dampingFactor={0.08} />
          </Suspense>
        </Canvas>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <button
          type="button"
          className="rounded-full border border-amber-300/40 px-4 py-1.5 text-xs text-amber-100 hover:border-amber-200 hover:text-amber-50"
          onClick={launch}
        >
          发射（或按 Enter）
        </button>
        <button
          type="button"
          className="rounded-full border border-cyan-300/30 px-4 py-1.5 text-xs text-cyan-100/80 hover:border-cyan-200/70"
          onClick={resetBall}
        >
          放回起点
        </button>
        <span className="text-xs text-cyan-100/45">
          按住能量球往后拉 → 松手即发射。拖得越远、越贴着下坡方向，lr 越大；超过{" "}
          {LR_STABILITY.toFixed(2)} 就飞出去。
        </span>
      </div>

      <div className="px-5 pb-6 text-xs leading-relaxed">
        <p className="text-cyan-100/70">
          <b className="text-cyan-50">怎么玩：</b>按住那颗金色<b>能量球</b>往后拉（像拉弹弓），松手发射。
          拉的方向与力度按 <code className="text-amber-200/80">lr = −(d·∇f)/|∇f|²</code> 换算成学习率：
          拉向下坡 → 正 lr，球沿谷底收敛；拉得越狠越接近 {LR_STABILITY.toFixed(2)}，开始在山谷壁上来回弹；
          拉过头或反向拉 → 直接冲出地形（那是个真实的失败模式，不是 bug）。
        </p>
        <p className="mt-2 text-cyan-100/55">
          灰线是最近三次发射的幽灵轨迹，用来对比手感。地形是{" "}
          <b>f(x,z) = ½({A}x² + {B}z²)</b> 的真值加了层涟漪；碗越扁（条件数越大），
          可用学习率区间越窄 —— 这就是 4.2 节「病态条件」在优化里的后果。
        </p>
        <p className="mt-2 text-cyan-100/40">{COPY.acceptance}</p>
        <p className="mt-1 text-cyan-100/40">结论：{COPY.conclusion}</p>
        {degraded ? <p className="mt-2 text-amber-300/70">帧率偏低，已自动降低渲染分辨率（AdaptiveDpr）。</p> : null}
      </div>
    </div>
  );
}
