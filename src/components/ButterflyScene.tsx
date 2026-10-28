"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

import { buildEcoButterfly, type ButterflyParts } from "@/lib/three/butterfly-scene";
import { buildFlagshipButterfly } from "@/lib/three/flagship-butterfly";
import { createWingAnimator, type WingAnimator } from "@/lib/three/wing-animator";
import { createCameraRig } from "@/lib/three/camera-rig";
import { createLabelController } from "@/lib/three/label-controller";
import { createLightPath } from "@/lib/three/light-path";
import { createInteractionMachine } from "@/lib/three/interaction-state";
import {
  CAMERA_DISTANCE,
  CAMERA_FOV,
  DESIGN_H,
  DESIGN_W,
  fractionToDesignPx,
  toWorld,
} from "@/lib/three/design-space";
import { MODULE_NODES, type NodeId, type WingSide } from "@/lib/nodes";
import { detectInitialTier, type RenderTier } from "@/lib/environment";
import {
  createFpsGovernor,
  readSyntheticFps,
  readTierOverride,
} from "@/lib/three/performance-tier";

type Props = {
  hoveredSide: WingSide | null;
  hoveredId: NodeId | null;
  /** 动画总闸：安静 / 静态 / 标签页失焦 / 面板打开时为 false */
  flowOn: boolean;
  /** 越大越慢（quiet 模式 1.65），只在这里作用于 clock 推进 */
  tempo: number;
  litPulse: { side: WingSide; key: number } | null;
  /** CSS 的 --glow：1 或 0.55 */
  glow: number;
  /** 安静 / 静态降级：状态机硬锁，翼瞬回正面、光路与粒子全关 */
  hardLock?: boolean;
  /** 档位定了之后回传给上层，用于 .is-flagship 关掉 CSS 浮动 */
  onTierDecided?: (tier: RenderTier) => void;
  /** 时序走完（≈1.3s）后才通知上层开面板 */
  onTransitionReady?: (node: NodeId) => void;
  /** 给上层一个命令入口：发起聚焦 / 开始返回 / 深链快进 */
  sceneApiRef?: { current: SceneApi | null };
};

export type SceneApi = {
  focus(node: NodeId): void;
  beginReturn(): void;
  skip(to: "locked" | "idle"): void;
};

export default function ButterflyScene({
  hoveredSide,
  hoveredId,
  flowOn,
  tempo,
  litPulse,
  glow,
  hardLock = false,
  onTierDecided,
  onTransitionReady,
  sceneApiRef,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const liveRef = useRef({ flowOn, tempo, glow, hoveredSide, hoveredId, hardLock });
  /* 每次渲染都同步最新 props，避免把依赖项塞进挂载 effect 里重建整个场景 */
  liveRef.current = { flowOn, tempo, glow, hoveredSide, hoveredId, hardLock };

  const dirtyRef = useRef(true);
  const conductRef = useRef<WingAnimator | null>(null);
  const clockRef = useRef(0);
  const paintedPulseRef = useRef(0);
  const tierRef = useRef<RenderTier>("flagship");
  /* 档位是异步定下来的，用 ref 传递避免把回调塞进挂载依赖里 */
  const onTierDecidedRef = useRef(onTierDecided);
  onTierDecidedRef.current = onTierDecided;
  const onTransitionReadyRef = useRef(onTransitionReady);
  onTransitionReadyRef.current = onTransitionReady;

  useEffect(() => {
    dirtyRef.current = true;
  }, [hoveredSide, hoveredId, glow, flowOn, tempo]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    /* canvas 由这里现场造、现场拆：StrictMode 会双挂载，
       复用同一个 canvas 加上 forceContextLoss 会让第二次挂载拿不到上下文。 */
    const canvas = document.createElement("canvas");
    canvas.className = "butterfly-canvas__gl";
    host.appendChild(canvas);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        /* 仅开发期：钩子要在一帧之后导出像素。生产环境保持 false，省下一次缓冲区拷贝。 */
        preserveDrawingBuffer: process.env.NODE_ENV === "development",
      });
    } catch (error) {
      console.warn("[butterfly3d] WebGL 不可用，跳过 3D 层（DOM 节点与中心球仍可用）：", error);
      canvas.remove();
      return;
    }

    renderer.setClearColor(0x000000, 0);

    const resolution = new THREE.Vector2(1, 1);
    const tier = readTierOverride() ?? detectInitialTier();
    tierRef.current = tier;

    const scene = new THREE.Scene();
    let parts: ButterflyParts;
    let lights: THREE.Object3D[] = [];

    if (tier === "flagship") {
      const built = buildFlagshipButterfly(resolution);
      parts = built.parts;
      lights = built.lights;
      for (const light of lights) scene.add(light);
    } else {
      parts = buildEcoButterfly(resolution);
    }
    scene.add(parts.root);

    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, DESIGN_W / DESIGN_H, 0.1, 200);
    camera.position.set(0, 0, CAMERA_DISTANCE);
    camera.lookAt(0, 0, 0);

    const rig = createCameraRig(camera);
    const labels = createLabelController();
    labels.collect(host.parentElement ?? host);

    const animator = createWingAnimator(parts);
    conductRef.current = animator;

    /* 节点世界坐标：hover 时给相机当聚焦目标 */
    const focusPoints = new Map<NodeId, THREE.Vector3>();
    for (const node of MODULE_NODES) {
      const [px, py] = fractionToDesignPx(node.x, node.y);
      focusPoints.set(node.id, new THREE.Vector3(...toWorld(px, py)));
    }

    let clock = clockRef.current;
    let frame = 0;
    let last = performance.now();
    let rigEnabled = tier === "flagship";

    const governor = createFpsGovernor((measuredFps) => {
      console.warn(
        `[butterfly3d] 实测帧率 ${measuredFps.toFixed(1)} < 45，自动降到节能档（只降不升）`,
      );
      applyTier("eco");
    });

    /**
     * 运行时降档不重建几何：旗舰档本身就是「节能档 + 立体附加层」，
     * 所以只要把附加层隐藏、灯关掉、相机回到固定位姿即可，代价近乎为零。
     */
    function applyTier(next: RenderTier) {
      tierRef.current = next;
      rigEnabled = next === "flagship";
      parts.mode = next;

      parts.root.traverse((object) => {
        if (object.userData.flagshipOnly === true) object.visible = rigEnabled;
        if (object.name === "legacyOrb" || object.name === "legacyGlint") {
          object.visible = !rigEnabled;
        }
      });
      for (const light of lights) light.visible = rigEnabled;

      if (!rigEnabled) rig.reset();
      else rig.update(clock, 1 / 60, "cruise", null);

      if (!rigEnabled) labels.reset();
      dirtyRef.current = true;
      onTierDecidedRef.current?.(next);
    }

    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;
      /* 相机长宽比必须跟容器一致，否则「世界坐标 → 屏幕百分比」和 DOM 节点层就对不上 */
      resolution.set(width, height);
      for (const material of parts.lineMaterials) material.resolution.set(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, rigEnabled ? 2 : 1.5));
      renderer.setSize(width, height, false);
      dirtyRef.current = true;
    };

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    applyTier(tier);

    const syntheticFps = readSyntheticFps();

    /* 交互状态机只负责时序与门控，不碰 three / DOM；光路是它唯一的渲染载体。
       光路自己会 reparent 到对应翼的 pivot 里（贴着已有脉络走），所以不挂到 scene。 */
    const machine = createInteractionMachine();
    const lightPath = createLightPath(resolution, parts.wings);
    let lastPathTarget: NodeId | null = null;
    let lastHoveredId: NodeId | null = null;
    /* 仅 dev：隐藏标签页里 pagePaused=true → flowOn=false → 动效与状态机都不推进，
       自动化断言就无从下手。这个开关只模拟"页面可见且聚焦"，不绕过任何业务分支。 */
    let debugForceFlow = false;

    const focusFor = (id: NodeId | null): THREE.Vector3 | null =>
      id ? focusPoints.get(id) ?? null : null;

    if (sceneApiRef) {
      sceneApiRef.current = {
        focus(node) {
          machine.click(node);
          dirtyRef.current = true;
        },
        beginReturn() {
          machine.returnStart();
          dirtyRef.current = true;
        },
        skip(to) {
          machine.skip(to);
          dirtyRef.current = true;
        },
      };
    }

    /**
     * 唯一的绘制路径。dev 钩子和 rAF 循环都走它 ——
     * 否则钩子会「看起来渲染正常」却漏掉标签投影，测试结论就成了假的。
     */
    const drawFrame = (value: number, dt: number) => {
      const state = liveRef.current;
      const flowOn = state.flowOn || debugForceFlow;
      const visible = !document.hidden || debugForceFlow;

      /* hover 是状态机的入口事件，不只是亮度开关：进 hover 会减速定格 + 亮虚影光路 */
      if (state.hoveredId !== lastHoveredId) {
        if (state.hoveredId) machine.hoverStart(state.hoveredId);
        else machine.hoverEnd();
        lastHoveredId = state.hoveredId;
      }

      const out = machine.update({
        dt,
        ticking: flowOn && visible,
        settled: rig.isSettled(),
        hardLock: state.hardLock,
      });

      if (machine.target !== lastPathTarget) {
        lightPath.setTarget(machine.target);
        lastPathTarget = machine.target;
      }

      if (rigEnabled) {
        rig.update(value, dt, out.camera, focusFor(machine.target));
        labels.place(camera, host.clientWidth, host.clientHeight);
      }

      animator.apply(value, dt, {
        flowOn,
        glow: state.glow,
        hoveredSide: state.hoveredSide,
        wingGate: out.wingGate,
        snapWings: out.snapWings,
        restartBreathing: out.restartBreathing,
      });

      lightPath.update(dt, out.path);
      renderer.render(scene, camera);

      if (out.transition && machine.target) {
        onTransitionReadyRef.current?.(machine.target);
      }
    };

    const loop = (now: number) => {
      const realDt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const state = liveRef.current;
      const visible = !document.hidden;

      governor.sample(syntheticFps ? 1 / syntheticFps : realDt, visible);

      if (state.flowOn) {
        /* tempo 是除数：1.65 时 clock 走得慢，所有周期自然变长 */
        clock += realDt / state.tempo;
        clockRef.current = clock;
        drawFrame(clock, realDt);
      } else if (dirtyRef.current) {
        /* 停帧：只补一帧静态画面（hover / glow / 档位变化时也要重绘） */
        drawFrame(clock, 1 / 60);
        dirtyRef.current = false;
      }

      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    if (process.env.NODE_ENV === "development") {
      reportAlignment(host, camera);
      /* 开发期检视钩子：隐藏标签页里 rAF 不跑，且 in-app Browser 未可见时截不了图，
         用它强制渲染指定时刻并读出渲染统计与单帧像素，才能验「有没有画、画得对不对、
         draw call 是否超预算」。生产构建里 NODE_ENV 被静态替换成 "production"，
         整个分支连同这些闭包一起被摇树掉，不会进产物。 */
      (window as unknown as Record<string, unknown>).__zjButterfly = {
        renderAt(value: number) {
          clock = value;
          clockRef.current = value;
          drawFrame(value, 1 / 60);
        },
        stats: () => ({
          tier: parts.mode,
          children: parts.root.children.length,
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          brightnessTargets: parts.brightness.length,
          packets: parts.flowPackets.length,
          camera: camera.position.toArray().map((v) => Number(v.toFixed(3))),
        }),
        /** 状态机当前态：给「光路不早于 settle」「四翼同步」这类断言用 */
        state: () => {
          const tip = (key: keyof typeof parts.wings) => {
            const v = parts.wings[key].localToWorld(new THREE.Vector3(6, 0, 0));
            return [Number(v.x.toFixed(3)), Number(v.y.toFixed(3)), Number(v.z.toFixed(3))];
          };
          return {
            phase: machine.phase,
            path: machine.path,
            hoveredId: liveRef.current.hoveredId,
            gate: Number(machine.wingGate.toFixed(4)),
            radius: Number(rig.radius.toFixed(3)),
            settled: rig.isSettled(),
            wings: {
              rightTop: Number(parts.wings.rightTop.rotation.y.toFixed(5)),
              leftTop: Number(parts.wings.leftTop.rotation.y.toFixed(5)),
              rightBottom: Number(parts.wings.rightBottom.rotation.y.toFixed(5)),
              leftBottom: Number(parts.wings.leftBottom.rotation.y.toFixed(5)),
              rx: Number(parts.wings.rightTop.rotation.x.toFixed(5)),
              rz: Number(parts.wings.rightTop.rotation.z.toFixed(5)),
            },
            /** 翼尖世界坐标：用来看"两翼是否朝同一侧开合" */
            tips: {
              rightTop: tip("rightTop"),
              leftTop: tip("leftTop"),
              rightBottom: tip("rightBottom"),
              leftBottom: tip("leftBottom"),
            },
            antennae: {
              left: Number(((parts.antennae.left.rotation.z * 180) / Math.PI).toFixed(2)),
              right: Number(((parts.antennae.right.rotation.z * 180) / Math.PI).toFixed(2)),
            },
          };
        },
        focus: (id: NodeId) => sceneApiRef?.current?.focus(id),
        returnStart: () => sceneApiRef?.current?.beginReturn(),
        skip: (to: "locked" | "idle") => sceneApiRef?.current?.skip(to),
        setForceFlow: (value: boolean) => {
          debugForceFlow = value;
        },
        snapshot: () => canvas.toDataURL("image/png"),
        setTier: applyTier,
      };
    }

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      conductRef.current = null;
      if (sceneApiRef) sceneApiRef.current = null;
      lightPath.dispose();
      for (const disposable of parts.disposables) disposable.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  /* 光轨命中节点 → 该侧脉络亮一波 */
  useEffect(() => {
    if (!litPulse || litPulse.key === paintedPulseRef.current) return;
    paintedPulseRef.current = litPulse.key;
    conductRef.current?.conduct(litPulse.side, clockRef.current);
  }, [litPulse]);

  return <div ref={hostRef} className="butterfly-canvas" aria-hidden="true" />;
}

/**
 * 开发期一次性自检：容器长宽比必须与设计稿一致，否则投影与 DOM 层的对应关系会偏。
 * 环绕档下标签每帧重投影，这里只验「相机几何本身对不对」。
 */
function reportAlignment(host: HTMLElement, camera: THREE.PerspectiveCamera) {
  const rect = host.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  camera.updateMatrixWorld(true);
  let worst = 0;
  for (const node of MODULE_NODES) {
    const [px, py] = fractionToDesignPx(node.x, node.y);
    const vector = new THREE.Vector3(...toWorld(px, py)).project(camera);
    const sx = (vector.x + 1) / 2;
    const sy = (1 - vector.y) / 2;
    worst = Math.max(worst, Math.abs(sx - node.x), Math.abs(sy - node.y));
  }

  console.log(
    `[butterfly3d] 容器 ${rect.width.toFixed(1)}×${rect.height.toFixed(1)}` +
      `（长宽比 ${(rect.width / rect.height).toFixed(4)}，设计稿 ${(DESIGN_W / DESIGN_H).toFixed(4)}）` +
      ` · 相机 aspect ${camera.aspect.toFixed(4)} · 固定机位下 3D↔DOM 最大偏差 ${(worst * 100).toFixed(4)}%`,
  );
  if (worst > 0.002) {
    console.warn("[butterfly3d] 固定机位投影偏差超过 0.2%，检查相机长宽比或 .butterfly-canvas 尺寸");
  }
}
