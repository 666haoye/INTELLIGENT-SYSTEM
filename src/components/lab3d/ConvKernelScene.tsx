"use client";

/* E27「手工卷积核 → 可学习卷积核」的 3D 沉浸式版本：核在图像上滑动，特征图堆成体。
 *
 * 交互两件事：在图像面上按住拖 = 移动 3×3 卷积窗（射线与图像平面求交后取整到像素）；
 * 在核的 9 根柱子上按住上下拖 = 在「手工 Sobel」与「随机初始化 + 在线训练」之间混合。
 * 混合一大于 0，就按静态页同节奏每帧跑 3 步梯度下降，柱子会自己长成 Sobel 的形状。
 *
 * 分工和另外三个场景一样：数学全在 src/lib/lab3d/conv-kernel.ts（已 node 断言：随机核起步
 * MSE 1.20e-1 → 400 步 6.9e-4，与 Sobel 余弦 0.9832），逐帧推进集中在一个 <Simulator> 里，
 * 别的组件只读不算。这里不写自定义 shader —— 上一轮 E22 就是 GLSL 里的 `pow(0, y)` 产出 NaN
 * 把整帧拖黑、而且 console 一声不响。
 */

import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { AdaptiveDpr, Line, OrbitControls, PerformanceMonitor } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import { damp3 } from "maath/easing";
import {
  IMAGE,
  INTERIOR,
  LR,
  N,
  PRESETS,
  SOBEL_K,
  STEPS_PER_FRAME,
  cosineSim,
  conv,
  mseVs,
  randomKernel,
  trainStep,
} from "@/lib/lab3d/conv-kernel";
import { labCopy } from "@/lib/lab3d/experiment-copy";
import PerfProbe, { type PerfSample } from "./PerfProbe";
import { useSceneDrag } from "./useSceneDrag";

const COPY = labCopy("E27");

/** 图像面在世界里的边长：64 像素 → 6.4 单位，一格 0.1。 */
const SIZE = 6.4;
const PX = SIZE / N;
/** 特征面叠在图像面上方，两层夹成一个「体」。 */
const FEATURE_Y = 1.55;
/** 核柱子的中线高度：权重正负从中线往上下长。 */
const BAR_MID = 0.78;
/** sharp 核的中心权重是 5，不软限幅会顶穿特征面。 */
const BAR_SCALE = 0.085;
const BAR_LIMIT = 0.5;
const DRAG_MIX_PER_PX = 0.006;
/** 400 步已经收敛，再往上跑只是白烧 CPU；到顶就停，按 R 重置。 */
const STEP_CAP = 1600;

const DARK = new THREE.Color("#071a2b");
const BRIGHT = new THREE.Color("#9fe8ff");
const POS_COLOR = "#4c7dff";
const NEG_COLOR = "#a78bfa";

/** 像素 (i 行, j 列) ↔ 世界 XZ。第 0 行落在 −Z：俯视时 −Z 在画面上方，和静态页「第 0 行在顶上」一致。 */
const xOf = (j: number) => ((j + 0.5) / N - 0.5) * SIZE;
const zOf = (i: number) => ((i + 0.5) / N - 0.5) * SIZE;
const toCol = (x: number) => Math.floor((x / SIZE + 0.5) * N);
const toRow = (z: number) => Math.floor((z / SIZE + 0.5) * N);

const IMAGE_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** 灰度 t ∈ [0,1] → 冷色渐变，写进纹理前夹紧（Bloom 只吃 [0,1]）。 */
function toneInto(data: Uint8Array, offset: number, tRaw: number): void {
  const t = Math.min(1, Math.max(0, tRaw));
  data[offset] = Math.round(255 * (DARK.r + (BRIGHT.r - DARK.r) * t));
  data[offset + 1] = Math.round(255 * (DARK.g + (BRIGHT.g - DARK.g) * t));
  data[offset + 2] = Math.round(255 * (DARK.b + (BRIGHT.b - DARK.b) * t));
  data[offset + 3] = 255;
}

/**
 * DataTexture 的第 0 行在 v=0（flipY 不翻），而平面旋转 −90° 后 local +Y 变成世界 −Z，
 * 于是纹理行要倒着写：图像第 i 行 → 纹理第 N−1−i 行，否则整张图上下颠倒。
 */
function writeRow(i: number, j: number, t: number, data: Uint8Array): void {
  toneInto(data, ((N - 1 - i) * N + j) * 4, t);
}

function makeTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array(N * N * 4), N, N, THREE.RGBAFormat);
  /* Nearest：数据纹理就是要一格一格，线性插值会把 64×64 糊成一块马赛克玻璃。 */
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** 原图纹理：灰度直接当 t 用，建一次就够（IMAGE 是常量）。 */
function buildImageTexture(): THREE.DataTexture {
  const texture = makeTexture();
  const data = texture.image.data as Uint8Array;
  for (let i = 0; i < N; i += 1) for (let j = 0; j < N; j += 1) writeRow(i, j, IMAGE[i * N + j], data);
  texture.needsUpdate = true;
  return texture;
}

/** 特征图纹理：和静态页 fillFeat 同一个归一化 —— (v+1)/2 再夹紧。 */
function refillFeature(texture: THREE.DataTexture, feat: Float64Array): void {
  const data = texture.image.data as Uint8Array;
  for (let i = 0; i < N; i += 1) {
    for (let j = 0; j < N; j += 1) {
      const v = (feat[i * N + j] + 1) / 2;
      writeRow(i, j, v, data);
    }
  }
  texture.needsUpdate = true;
}

type Hud = {
  mix: number;
  steps: number;
  mse: number;
  cosine: number;
  row: number;
  col: number;
  trained: boolean;
};

type Rig = {
  mixRef: React.MutableRefObject<number>;
  winRef: React.MutableRefObject<{ row: number; col: number }>;
  trainer: number[];
  display: number[];
  feat: Float64Array;
  stepCount: React.MutableRefObject<number>;
  featureTexture: THREE.DataTexture;
  onHud: (hud: Hud) => void;
};

/** 唯一的每帧推进：训练 → 混合出显示用核 → conv 刷特征纹理 → 低频回传 HUD。 */
function Simulator({
  mixRef,
  winRef,
  trainer,
  display,
  feat,
  stepCount,
  featureTexture,
  onHud,
}: Rig) {
  const hudClock = useRef(0);
  const paintClock = useRef(0);

  useFrame((_, delta) => {
    const mix = mixRef.current;
    let stepped = 0;
    if (mix > 0.001) {
      while (stepped < STEPS_PER_FRAME && stepCount.current < STEP_CAP) {
        trainStep(trainer, feat);
        stepCount.current += 1;
        stepped += 1;
      }
    }
    for (let w = 0; w < 9; w += 1) display[w] = SOBEL_K[w] * (1 - mix) + trainer[w] * mix;

    /* conv 是 64×64×9 ≈ 3.7 万次乘法，纹理回填又是 4096 次颜色计算。
       数据纹理本来就不需要跟到 240fps，按 30Hz 刷一次就够，剩下的帧全省下来。 */
    paintClock.current += delta;
    if (paintClock.current > 0.033) {
      paintClock.current = 0;
      conv(display, feat);
      refillFeature(featureTexture, feat);
    }

    /* HUD 按 ~6Hz 回传：逐帧 setState 会把整棵 React 树拽进渲染循环。 */
    hudClock.current += delta;
    if (hudClock.current > 0.16) {
      hudClock.current = 0;
      const { row, col } = winRef.current;
      onHud({
        mix,
        steps: stepCount.current,
        /* 不复用 feat 当 scratch：mseVs 内部会 conv 覆盖它，虽然算出来是同一份内容，
           但让一个只读指标去动渲染缓冲，迟早把自己绕进去。这里 6Hz，分配一条 4096 的数组无所谓。 */
        mse: mseVs(display),
        cosine: cosineSim(display),
        row,
        col,
        trained: stepCount.current > 0,
      });
    }
  });

  return null;
}

/** 图像面 + 特征面 + 四角立柱与顶框：form 里说的「多通道特征图堆叠成体」。 */
function Slab({ imageTexture, featureTexture }: { imageTexture: THREE.DataTexture; featureTexture: THREE.DataTexture }) {
  const half = SIZE / 2;
  const corners = useMemo(() => {
    const arr: number[] = [];
    for (const sx of [-half, half]) for (const sz of [-half, half]) arr.push(sx, 0, sz, sx, FEATURE_Y, sz);
    return new Float32Array(arr);
  }, [half]);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <planeGeometry args={[SIZE, SIZE, 1, 1]} />
        <meshBasicMaterial map={imageTexture} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FEATURE_Y, 0]} raycast={() => null}>
        <planeGeometry args={[SIZE, SIZE, 1, 1]} />
        <meshBasicMaterial map={featureTexture} toneMapped={false} transparent opacity={0.95} />
      </mesh>
      <lineSegments raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[corners, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#1f5f80" transparent opacity={0.55} />
      </lineSegments>
      <Line
        points={[
          [-half, FEATURE_Y, -half],
          [half, FEATURE_Y, -half],
          [half, FEATURE_Y, half],
          [-half, FEATURE_Y, half],
          [-half, FEATURE_Y, -half],
        ]}
        color="#2b7fa6"
        lineWidth={1.4}
        raycast={() => null}
      />
    </group>
  );
}

/** 卷积窗：图像上的发光方框 + 特征面上对应那一格的亮点，两处同步滑动。 */
function WindowMarker({ winRef }: { winRef: Rig["winRef"] }) {
  const frame = useRef<THREE.Group>(null);
  const cell = useRef<THREE.Group>(null);
  const pos = useMemo(() => new THREE.Vector3(xOf(16), 0.014, zOf(16)), []);
  const top = useMemo(() => new THREE.Vector3(xOf(16), FEATURE_Y + 0.02, zOf(16)), []);
  const target = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const { row, col } = winRef.current;
    target.set(xOf(col), 0.014, zOf(row));
    damp3(pos, target, 0.09, delta);
    if (frame.current) frame.current.position.copy(pos);
    target.set(xOf(col), FEATURE_Y + 0.02, zOf(row));
    damp3(top, target, 0.09, delta);
    if (cell.current) cell.current.position.copy(top);
  });

  return (
    <>
      <group ref={frame}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <planeGeometry args={[3 * PX, 3 * PX, 1, 1]} />
          <meshBasicMaterial color="#7fe6ff" transparent opacity={0.17} depthWrite={false} />
        </mesh>
        <Line
          points={[
            [-1.5 * PX, 0.002, -1.5 * PX],
            [1.5 * PX, 0.002, -1.5 * PX],
            [1.5 * PX, 0.002, 1.5 * PX],
            [-1.5 * PX, 0.002, 1.5 * PX],
            [-1.5 * PX, 0.002, -1.5 * PX],
          ]}
          color="#9df0ff"
          lineWidth={2.8}
          raycast={() => null}
        />
      </group>
      <group ref={cell}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <planeGeometry args={[PX * 0.92, PX * 0.92, 1, 1]} />
          <meshBasicMaterial color="#ffd166" transparent opacity={0.8} depthWrite={false} />
        </mesh>
      </group>
    </>
  );
}

const BAR_SLOTS = Array.from({ length: 9 }, (_, w) => w);

export default function ConvKernelScene() {
  const mixRef = useRef(0);
  const winRef = useRef({ row: 16, col: 16 });
  const stepCount = useRef(0);
  const modeRef = useRef<"window" | "mix">("window");
  const trainer = useMemo(() => randomKernel(), []);
  const display = useMemo(() => SOBEL_K.slice(), []);
  const feat = useMemo(() => {
    const out = new Float64Array(N * N);
    conv(SOBEL_K, out);
    return out;
  }, []);
  const imageTexture = useMemo(buildImageTexture, []);
  const featureTexture = useMemo(makeTexture, []);
  const barsRef = useRef<THREE.Group>(null);
  const [hud, setHud] = useState<Hud>({
    mix: 0,
    steps: 0,
    mse: 0,
    cosine: 1,
    row: 16,
    col: 16,
    trained: false,
  });
  const [perf, setPerf] = useState<PerfSample>({ fps: 0, calls: 0, tris: 0 });
  const [degraded, setDegraded] = useState(false);

  const onHud = useCallback((next: Hud) => setHud(next), []);
  const setMix = useCallback(
    (next: number) => {
      mixRef.current = Math.min(1, Math.max(0, next));
    },
    [],
  );

  /* 一个 useSceneDrag 实例服务两个拖拽源（OrbitControls 的 ref 只有一处，禁用/恢复才不会漏）。
     按下时先记住摸到的是什么，onDrag 再按这个分派。 */
  const drag = useSceneDrag({
    onDrag: (_dx, dy, event: ThreeEvent<PointerEvent>) => {
      if (modeRef.current === "mix") {
        setMix(mixRef.current - dy * DRAG_MIX_PER_PX);
        return;
      }
      const hit = new THREE.Vector3();
      if (event.ray.intersectPlane(IMAGE_PLANE, hit)) {
        winRef.current = {
          row: Math.min(N - 2, Math.max(1, toRow(hit.z))),
          col: Math.min(N - 2, Math.max(1, toCol(hit.x))),
        };
      }
    },
  });

  const windowHandlers = useMemo(
    () => ({
      ...drag.handlers,
      onPointerDown: (event: ThreeEvent<PointerEvent>) => {
        modeRef.current = "window";
        drag.handlers.onPointerDown(event);
      },
    }),
    [drag.handlers],
  );
  const mixHandlers = useMemo(
    () => ({
      ...drag.handlers,
      onPointerDown: (event: ThreeEvent<PointerEvent>) => {
        modeRef.current = "mix";
        drag.handlers.onPointerDown(event);
      },
    }),
    [drag.handlers],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 0.2 : 0.05;
    if (event.key === "ArrowUp" || event.key === "PageUp") setMix(mixRef.current + step);
    else if (event.key === "ArrowDown" || event.key === "PageDown") setMix(mixRef.current - step);
    else if (event.key === "Home") setMix(0);
    else if (event.key === "End") setMix(1);
    else if (event.key === "r" || event.key === "R") {
      const fresh = randomKernel();
      for (let w = 0; w < 9; w += 1) trainer[w] = fresh[w];
      stepCount.current = 0;
    } else return;
    event.preventDefault();
  };

  const modeLabel =
    hud.mix < 0.02
      ? `手工核 · ${PRESETS.sobel.label}`
      : hud.mix > 0.98
        ? "可学习核"
        : `混合 ${(hud.mix * 100).toFixed(0)}% · ${hud.trained ? "训练中" : "待训练"}`;

  return (
    <div className="min-h-screen bg-[#010204] text-[#dff6ff]">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-cyan-100/10 px-5 py-4">
        <div className="min-w-0">
          <p className="text-[10px] tracking-[0.2em] text-cyan-200/50">
            R3F · {COPY.code} · 滑动卷积窗与可学习核
          </p>
          <h1 className="text-lg font-semibold">{COPY.title}</h1>
          <p className="text-xs text-cyan-100/50">{COPY.source}</p>
        </div>
        <dl className="flex flex-wrap gap-5 text-[11px] font-mono">
          {[
            ["模式", modeLabel],
            ["训练步数", `${hud.steps}${hud.steps >= STEP_CAP ? "（已到上限）" : ""}`],
            ["与 Sobel 的 MSE", hud.mse.toExponential(2)],
            ["核尺寸", "3×3"],
            ["余弦相似度", hud.cosine.toFixed(3)],
            ["窗口 (行,列)", `(${hud.row}, ${hud.col})`],
            ["FPS", String(perf.fps || "—")],
            ["draw calls", String(perf.calls || "—")],
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
        aria-label="三维卷积场景。在图像面上拖动移动卷积窗，在核柱子上上下拖动切换手工核与可学习核。"
        onKeyDown={onKeyDown}
      >
        <Canvas dpr={[1, 2]} camera={{ position: [2.2, 4.6, 7.0], fov: 42 }} gl={{ antialias: true }}>
          <color attach="background" args={["#010204"]} />
          <ambientLight intensity={0.7} />
          <directionalLight position={[4, 8, 5]} intensity={1.05} />
          <pointLight position={[-3, 3, 3]} intensity={13} color="#69d8ff" />
          <Suspense fallback={null}>
            <Slab imageTexture={imageTexture} featureTexture={featureTexture} />
            <Simulator
              mixRef={mixRef}
              winRef={winRef}
              trainer={trainer}
              display={display}
              feat={feat}
              stepCount={stepCount}
              featureTexture={featureTexture}
              onHud={onHud}
            />
            <WindowMarker winRef={winRef} />
            {/* 柱子本身只有 0.08 宽，不好抓：这组 mesh 挂在柱子锚点上，既是视觉主体也是拖拽靶。 */}
            <group ref={barsRef} {...mixHandlers}>
              {BAR_SLOTS.map((w) => (
                <KernelBar key={w} slot={w} />
              ))}
              <mesh rotation={[-Math.PI / 2, 0, 0]} visible={false}>
                <planeGeometry args={[3.6 * PX, 5.2 * PX, 1, 1]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
            </group>
            <KernelBarsMover display={display} winRef={winRef} barsRef={barsRef} />
            {/* 隐形抓取板：盖在整张图像上，负责「拖 = 移动卷积窗」。 */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} {...windowHandlers}>
              <planeGeometry args={[SIZE, SIZE, 1, 1]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            <OrbitControls ref={drag.attach} makeDefault enablePan={false} target={[0, 0.5, 0]} />
            <EffectComposer>
              <Bloom mipmapBlur intensity={0.6} luminanceThreshold={0.62} luminanceSmoothing={0.22} />
            </EffectComposer>
            <PerformanceMonitor onDecline={() => setDegraded(true)} onFallback={() => setDegraded(true)} />
            {degraded ? <AdaptiveDpr pixelated /> : null}
            <PerfProbe onSample={setPerf} />
          </Suspense>
        </Canvas>
      </div>

      <div className="px-5 py-4 text-xs leading-relaxed">
        <p className="text-cyan-100/70">
          <b className="text-cyan-50">怎么玩：</b>在<b>图像面</b>上按住拖 = 移动 3×3 卷积窗（射线与图像平面求交后
          取整到像素，锁在内部 62×62 里）；在<b>核的 9 根柱子</b>上按住上下拖 = 从「手工 Sobel」拉到
          「随机初始化 + 在线训练」（↑ 交给网络自己学 / ↓ 拉回手工核）；<b>空白处</b>拖 = 转视角；
          场景聚焦后 ↑/↓ 微调混合、Shift 走大步、Home/End 到两端、R 重置训练。
        </p>
        <p className="mt-2 text-cyan-100/55">
          下面一层是原图（64×64 程序化灰度：亮方块 / 暗圆 / 亮斜线），上面一层是当前核的输出{" "}
          <code className="text-cyan-200/80">conv(k)</code>，按静态页的 <code>(v+1)/2</code> 归一化显示，
          两层用四角立柱与顶框夹成一个体。柱子就是那 9 个权重：蓝正紫负、高度是幅度。混合拉满时它们会自己长成{" "}
          <code>[-1,0,1,−2,0,2,−1,0,1]</code>。
        </p>
        <p className="mt-2 text-cyan-100/40">
          口径与静态页一致：LR={LR}、每帧 {STEPS_PER_FRAME} 步、损失只取内部 {INTERIOR.toLocaleString()} 个像素
          （去掉一圈边界），所以墙上的 MSE 和静态页逐位同源。{STEP_CAP} 步后停止训练（400 步已收敛，再跑只是白烧 CPU），按 R 重置。
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

/** 单根柱子：静态摆位，幅度/符号/颜色由 KernelBarsMover 每帧写。 */
function KernelBar({ slot }: { slot: number }) {
  return (
    <mesh position={[((slot % 3) - 1) * PX * 1.12, 0, (Math.floor(slot / 3) - 1) * PX * 1.12]}>
      <boxGeometry args={[PX * 0.82, 1, PX * 0.82]} />
      <meshStandardMaterial color={POS_COLOR} emissive={POS_COLOR} emissiveIntensity={1.4} roughness={0.35} />
    </mesh>
  );
}

/** 把「读 display → 改柱子」这件事留在渲染层，但它不产生任何数学。 */
function KernelBarsMover({
  display,
  winRef,
  barsRef,
}: {
  display: number[];
  winRef: Rig["winRef"];
  barsRef: React.MutableRefObject<THREE.Group | null>;
}) {
  const anchor = useMemo(() => new THREE.Vector3(xOf(16), BAR_MID, zOf(16)), []);
  const target = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const { row, col } = winRef.current;
    target.set(xOf(col), BAR_MID, zOf(row));
    damp3(anchor, target, 0.11, delta);
    const group = barsRef.current;
    if (!group) return;
    group.position.copy(anchor);
    const nodes = group.children;
    for (let w = 0; w < 9 && w < nodes.length; w += 1) {
      const node = nodes[w] as THREE.Mesh;
      const weight = display[w];
      const span = Math.sign(weight) * Math.min(BAR_LIMIT, Math.abs(weight) * BAR_SCALE);
      node.scale.set(1, Math.max(0.006, Math.abs(span)), 1);
      node.position.set(
        ((w % 3) - 1) * PX * 1.12,
        /* box 是 1 单位高的几何体，缩放后往下挪半根，柱底就落在中线上 */
        span / 2,
        (Math.floor(w / 3) - 1) * PX * 1.12,
      );
      const hex = weight >= 0 ? POS_COLOR : NEG_COLOR;
      const material = node.material as THREE.MeshStandardMaterial;
      material.color.set(hex);
      material.emissive.set(hex);
      material.emissiveIntensity = 1 + Math.min(1.6, Math.abs(weight));
    }
  });

  return null;
}
