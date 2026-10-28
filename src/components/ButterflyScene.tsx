"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

import { buildEcoButterfly, type ButterflyParts } from "@/lib/three/butterfly-scene";
import { buildFlagshipButterfly } from "@/lib/three/flagship-butterfly";
import { createNodeRings } from "@/lib/three/node-rings";
import { createHoverResolver } from "@/lib/three/hover-raycast";
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
import { MODULE_NODES, NODE_BY_ID, type ModuleNode, type NodeId, type WingSide } from "@/lib/nodes";
import { detectInitialTier, type RenderTier } from "@/lib/environment";
import {
  createFpsGovernor,
  readSyntheticFps,
  readTierOverride,
} from "@/lib/three/performance-tier";

type Props = {
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
  /** 给上层一个命令入口：发起聚焦 / 开始返回 / 深链快进 / 并入键盘 focus */
  sceneApiRef?: { current: SceneApi | null };
};

export type SceneApi = {
  focus(node: NodeId): void;
  beginReturn(): void;
  skip(to: "locked" | "idle"): void;
  /**
   * DOM 侧的 hover（键盘 focus / blur）并进食口。
   * hover 判定本身在 3D 里（热区射线 + 300ms 迟滞），这里只是把 DOM 那一路合进来。
   */
  setDomHover(node: ModuleNode | null): void;
};

export default function ButterflyScene({
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
  const liveRef = useRef({ flowOn, tempo, glow, hardLock });
  /* 每次渲染都同步最新 props，避免把依赖项塞进挂载 effect 里重建整个场景 */
  liveRef.current = { flowOn, tempo, glow, hardLock };

  /** 射线 + DOM 并集、再经 300ms 迟滞后的 hover —— 唯一的 hover 真相 */
  const hoverRef = useRef<NodeId | null>(null);

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
  }, [glow, flowOn, tempo, hardLock]);

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

    /* 节点环两档都建，而且挂在翼 pivot 下（跟着折叠走），所以降档时不用重挂 */
    const rings = createNodeRings(parts, resolution);

    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, DESIGN_W / DESIGN_H, 0.1, 200);
    camera.position.set(0, 0, CAMERA_DISTANCE);
    camera.lookAt(0, 0, 0);

    const rig = createCameraRig(camera);
    /* 标签投影的是环心的当前世界坐标，不是静态设计坐标 —— 环走字就走，不会脱开 */
    const labels = createLabelController(rings.worldPosition);
    labels.collect(host.parentElement ?? host);

    const animator = createWingAnimator(parts);
    conductRef.current = animator;

    /* hover 主源：射线打在不可见球形热区上。监听挂在 .butterfly-float（canvas 本身
       pointer-events:none），触屏不发 mouse/pen 的 pointermove，所以不会误触发推镜。 */
    const floatHost = host.parentElement ?? host;
    const resolver = createHoverResolver(camera, floatHost, rings.worldPosition);

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "mouse" || event.pointerType === "pen") {
        resolver.setPointer(event.clientX, event.clientY);
      } else {
        resolver.clearPointer();
      }
    };
    const onPointerLeave = () => resolver.clearPointer();
    floatHost.addEventListener("pointermove", onPointerMove);
    floatHost.addEventListener("pointerleave", onPointerLeave);

    /* 聚焦目标：环心的实时世界坐标。
       刻意不用静态设计坐标 —— 环贴着翼面，折叠会让它在 z 上来回摆 0.26 世界单位，
       推镜后这个深度差被放大成 ~36 CSS 像素的横向漂移（比整个热区半径还大），
       指针就会被自己推出来的画面甩出热区，形成横跳。射线跟着环心走，投影才纹丝不动。 */
    const focusScratch = new THREE.Vector3();
    const focusFor = (id: NodeId | null): THREE.Vector3 | null =>
      id ? rings.worldPosition(id, focusScratch) : null;

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
      /* 容器矩形变了，热区判定的 NDC 换算必须重新取一次 rect */
      resolver.invalidateRect();
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
        setDomHover(node) {
          resolver.setDomHover(node?.id ?? null);
          dirtyRef.current = true;
        },
      };
    }

    /** 迟滞判定每帧都要跑，停帧分支也不例外，否则 300ms 永远走不完 */
    const stepHover = (dt: number) => {
      const id = resolver.resolve(dt);
      if (id !== hoverRef.current) {
        hoverRef.current = id;
        dirtyRef.current = true;
      }
    };

    /**
     * 唯一的绘制路径。dev 钩子和 rAF 循环都走它 ——
     * 否则钩子会「看起来渲染正常」却漏掉标签投影，测试结论就成了假的。
     */
    const drawFrame = (value: number, dt: number) => {
      const state = liveRef.current;
      const flowOn = state.flowOn || debugForceFlow;
      const visible = !document.hidden || debugForceFlow;
      const hoveredId = hoverRef.current;

      /* 只有 idle / hover 两个态吃 hover 事件。锁止与返回期间连"上一次是谁"都不更新，
         所以回到 idle 后指针若还停在环上会补一次 hoverStart，不会出现"亮着但不聚焦"。 */
      const phase = machine.phase;
      if (phase === "idle" || phase === "hover") {
        if (hoveredId !== lastHoveredId) {
          if (hoveredId) machine.hoverStart(hoveredId);
          else machine.hoverEnd();
          lastHoveredId = hoveredId;
        } else if (hoveredId && phase === "idle") {
          machine.hoverStart(hoveredId);
        }
      }

      const out = machine.update({
        dt,
        ticking: flowOn && visible,
        /* 节能档不跑相机，rig 的 settled 永远是 false —— 那样光路的闸门就永远打不开，
           点了节点卡在 locking、面板再也不出来。机位本来就固定，构图「稳定」是定义成立的。 */
        settled: rigEnabled ? rig.isSettled() : true,
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

      /* 环：hover / 锁止 / 安静三路输入。锁止高亮一直保持到整段返回走完才松，
         这样"点击 → 转场 → 返回"读起来是一个连贯的手势。 */
      rings.setHover(hoveredId);
      rings.setActive(machine.phase === "idle" || machine.phase === "hover" ? null : machine.target);
      rings.setQuiet(state.hardLock);
      rings.update(dt, flowOn && !state.hardLock);

      animator.apply(value, dt, {
        flowOn,
        glow: state.glow,
        hoveredSide: hoveredId ? NODE_BY_ID[hoveredId].side : null,
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
      stepHover(realDt);

      if (state.flowOn) {
        /* tempo 是除数：1.65 时 clock 走得慢，所有周期自然变长 */
        clock += realDt / state.tempo;
        clockRef.current = clock;
        drawFrame(clock, realDt);
      } else if (dirtyRef.current || rings.busy) {
        /* 停帧：只补静态画面（hover / glow / 档位变化时也要重绘）。
           hover 展开属于 transition 而不是 animation，安静档里也得跟手，
           所以环还在动时继续补帧，并用真实 dt。 */
        drawFrame(clock, rings.busy ? realDt : 1 / 60);
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
        /** 手动推进一帧（含迟滞计时）：隐藏标签页里 rAF 不跑，横跳回归只能靠它 */
        tick(dt: number) {
          clock += dt;
          clockRef.current = clock;
          stepHover(dt);
          drawFrame(clock, dt);
          return hoverRef.current;
        },
        pointer: (clientX: number, clientY: number) => resolver.setPointer(clientX, clientY),
        clearPointer: () => resolver.clearPointer(),
        /** 射线命中 / DOM 输入 / 迟滞后的提交值 + 已累积的离开时长 */
        hover: () => resolver.inspect(),
        /** 逐层 α、中层转速、展开环可见性、环心世界坐标 */
        rings: (id: NodeId) => rings.inspect(id),
        /** 光路终点世界坐标：断言它精确落在宝珠上 */
        pathEnd: () => {
          const v = lightPath.worldEnd(new THREE.Vector3());
          return v ? v.toArray().map((n) => Number(n.toFixed(4))) : null;
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
            hoveredId: hoverRef.current,
            ringsBusy: rings.busy,
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
        /** 按类型数一遍真正会提交绘制的对象，用来核对 draw call 账 */
        objects: () => {
          const tally: Record<string, number> = { fatLines: 0, sprites: 0, meshes: 0, points: 0 };
          parts.root.traverse((object) => {
            const mesh = object as THREE.Mesh | THREE.Sprite | THREE.Points;
            if (!mesh.visible) return;
            const geometry = (mesh as THREE.Mesh).geometry as
              | (THREE.BufferGeometry & { isLineSegmentsGeometry?: boolean })
              | undefined;
            if (geometry?.isLineSegmentsGeometry) tally.fatLines += 1;
            else if ((mesh as THREE.Sprite).isSprite) tally.sprites += 1;
            else if ((mesh as THREE.Points).isPoints) tally.points += 1;
            else if ((mesh as THREE.Mesh).isMesh) tally.meshes += 1;
          });
          return tally;
        },
        setTier: applyTier,
      };
    }

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      floatHost.removeEventListener("pointermove", onPointerMove);
      floatHost.removeEventListener("pointerleave", onPointerLeave);
      conductRef.current = null;
      hoverRef.current = null;
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
 * 开发期一次性自检：容器长宽比必须与设计稿一致，且「固定机位下世界坐标 → 容器百分比」
 * 必须逐点相等 —— 这是 DOM 标签层和 3D 层能对齐的全部前提。
 *
 * 判定用一台**放回初始机位的探针相机**，不用现场这台：旗舰档的 rig 在 applyTier 里
 * 已经把相机推到 6° 俯仰的巡航位姿上，那本来就是要靠 labels.place 逐帧补偿的偏移，
 * 拿它当"映射错了"来报只会刷一条假警告（实测 0.4%）。
 */
function reportAlignment(host: HTMLElement, camera: THREE.PerspectiveCamera) {
  const rect = host.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const probe = new THREE.PerspectiveCamera(CAMERA_FOV, camera.aspect, 0.1, 200);
  probe.position.set(0, 0, CAMERA_DISTANCE);
  probe.lookAt(0, 0, 0);
  probe.updateMatrixWorld(true);

  let worst = 0;
  for (const node of MODULE_NODES) {
    const [px, py] = fractionToDesignPx(node.x, node.y);
    const vector = new THREE.Vector3(...toWorld(px, py)).project(probe);
    const sx = (vector.x + 1) / 2;
    const sy = (1 - vector.y) / 2;
    worst = Math.max(worst, Math.abs(sx - node.x), Math.abs(sy - node.y));
  }

  const aspectError = Math.abs(camera.aspect - rect.width / rect.height) / (rect.width / rect.height);
  console.log(
    `[butterfly3d] 容器 ${rect.width.toFixed(1)}×${rect.height.toFixed(1)}` +
      `（长宽比 ${(rect.width / rect.height).toFixed(4)}，设计稿 ${(DESIGN_W / DESIGN_H).toFixed(4)}）` +
      ` · 相机 aspect ${camera.aspect.toFixed(4)}（误差 ${(aspectError * 100).toFixed(3)}%，来自 clientWidth 取整）` +
      ` · 固定机位下 3D↔DOM 最大偏差 ${(worst * 100).toFixed(4)}%`,
  );
  if (worst > 0.002) {
    console.warn("[butterfly3d] 固定机位投影偏差超过 0.2%，检查相机 fov/距离或 .butterfly-canvas 尺寸");
  }
  if (aspectError > 0.005) {
    console.warn("[butterfly3d] 相机长宽比与容器差 0.5% 以上，投影与 DOM 层的对应关系会偏");
  }
}
