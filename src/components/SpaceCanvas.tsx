"use client";

/* 深空背景层：独立全屏 WebGL（3D 星空），自带 renderer / scene / camera / rAF。
 *
 * 只做静态纵深。「划过」的语义由 TrailsCanvas（2D 蓝色光轨）承担，而且它驱动
 * onNodeLit / onNodeNear，是功能性反馈 —— 再加一套 3D 流星是重复表达，已移除。
 *
 * 为什么不塞进 ButterflyScene 的那个场景：蝴蝶画布是 .butterfly-center
 * （width:min(112vw,178vh); aspect-ratio:8/5），它不是全屏 —— 手机 390×844 上只有
 * 中间 437×273 一条横带，星空会被裁掉、不透明背景会露出一个会随 .butterfly-float
 * 上下移动的矩形。而蝴蝶相机的 aspect 必须恒等于 DESIGN_W/DESIGN_H（DOM 标签对齐
 * 契约），也不能靠改画布尺寸解决。所以背景另开一层，与蝴蝶零耦合。
 * 参数事实源：ANIMATION_SPEC.md §5b。
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";

import {
  SPACE_BG_COLOR,
  SPACE_DPR_CAP,
  SPACE_FAR,
  SPACE_NEAR,
  createSpaceCamera,
  type SpaceView,
} from "@/lib/three/deep-space";
import { createStarfield, type Starfield } from "@/lib/three/starfield";
import { readTierOverride } from "@/lib/three/performance-tier";
import type { RenderTier } from "@/lib/environment";

type Props = {
  /** 静态降级（reduced-motion / 离线 / 弱机）下不挂载 WebGL，只留 CSS 平涂 #020205 */
  enabled: boolean;
  /** 冻结星空并停 rAF，只留最后一帧静态画面 */
  quiet: boolean;
  /** 标签页失焦或面板打开：冻在当下，恢复后接着走 */
  paused: boolean;
  /** 档位由蝴蝶层判定并回传；null 表示还没定，此时先按旗舰档建，定了再重建 */
  tier: RenderTier | null;
};

const STAR_COUNT: Record<RenderTier, number> = { flagship: 2600, eco: 1800 };
const STAR_TWINKLE: Record<RenderTier, boolean> = { flagship: true, eco: false };

/** 只有转屏这种量级的形变才值得重撒星点：cap 半角跟着 aspect 走，但同种子重撒出来的
 *  统计观感一致，15% 以内的窗口拖拽没必要动它。 */
const ASPECT_REBUILD_THRESHOLD = 0.15;

/** 帧间隔上限，与蝴蝶层同值：切回标签页时第一帧的 dt 是"离开多久"，不是帧间隔 */
const MAX_DT = 0.05;

type SpaceControls = {
  /** quiet / paused 变了之后重估循环；停着的时候补画一帧，别让画面停在旧状态 */
  syncState(): void;
  applyTier(tier: RenderTier): void;
};

export default function SpaceCanvas({ enabled, quiet, paused, tier }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  /** 每次渲染都同步最新 props，避免把它们塞进挂载 effect 的依赖里重建整个 WebGL 上下文 */
  const liveRef = useRef({ quiet, paused });
  liveRef.current = { quiet, paused };

  /* 初值要读 readTierOverride()（dev 的 ?tier=eco），否则用它验节能档时背景层还是
     旗舰档，验收结论是假的。 */
  const tierRef = useRef<RenderTier>(readTierOverride() ?? tier ?? "flagship");
  tierRef.current = readTierOverride() ?? tier ?? "flagship";

  const controlsRef = useRef<SpaceControls | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const host = hostRef.current;
    if (!host) return;

    /* canvas 现场造、现场拆：StrictMode 双挂载时复用同一个 canvas 会让第二次挂载
       拿不到上下文（蝴蝶层同一套理由，见 ButterflyScene.tsx:97）。 */
    const canvas = document.createElement("canvas");
    canvas.className = "space-canvas__gl";
    host.appendChild(canvas);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        /* 这一层永远不透明，所以不要 alpha 通道；全层没有任何深度写入，深度/模板附件
           是纯浪费。点精灵的抗锯齿靠 shader 里的高斯衰减，MSAA 帮不上忙。 */
        alpha: false,
        depth: false,
        stencil: false,
        antialias: false,
        preserveDrawingBuffer: process.env.NODE_ENV === "development",
      });
    } catch (error) {
      console.warn("[space3d] WebGL 不可用，跳过深空背景层（CSS 平涂 #020205 兜底）：", error);
      canvas.remove();
      return;
    }

    const scene = new THREE.Scene();
    /* 用户要的"scene.background = 极深邃暗黑"就落在这里。这一层是 fixed inset 0 全屏，
       所以它是真正铺满整屏的背景，而不是蝴蝶那个 8:5 框里的一块矩形。 */
    scene.background = new THREE.Color(SPACE_BG_COLOR);

    /* view 对象由本层独占并在 resize 时原地改字段：星空每帧读它的 aspect 与
       pixelRatio，换成新对象会让它读到过期值。 */
    const view: SpaceView = { width: 1, height: 1, aspect: 1, pixelRatio: 1 };
    const camera = createSpaceCamera(1);
    const bufferSize = new THREE.Vector2();
    const readBuffer = new Uint8Array(4);

    /** 把视口写进 view / camera / renderer。必须先于建模块：星壳的 cap 半角要读 aspect。 */
    const applyViewport = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      if (!width || !height) return false;

      view.width = width;
      view.height = height;
      view.aspect = width / height;
      /* 上限 1.5 而不是 2：本层的主要成本是每帧一次全屏 opaque clear，严格正比于
         drawingBuffer 像素数；而最细的特征是 1~3px 的点精灵，dpr2 的收益几乎为零。 */
      view.pixelRatio = Math.min(window.devicePixelRatio || 1, SPACE_DPR_CAP);

      camera.aspect = view.aspect;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(view.pixelRatio);
      renderer.setSize(width, height, false);
      return true;
    };

    const buildStarfield = (tier: RenderTier): Starfield =>
      createStarfield({
        count: STAR_COUNT[tier],
        view,
        camera,
        twinkle: STAR_TWINKLE[tier],
      });

    applyViewport();

    let starfield = buildStarfield(tierRef.current);
    scene.add(starfield.object);
    let activeTier = tierRef.current;
    let lastAspect = view.aspect;

    let frame = 0;
    let last = 0;
    let pendingResize = 0;

    const paint = () => renderer.render(scene, camera);

    /** 把一帧的运动量交给星空：自转、闪烁时钟与相机漂移都在它内部累积。 */
    const advance = (dt: number) => {
      starfield.update(dt);
    };

    /**
     * 一帧的门控逻辑，rAF 循环与 dev 钩子的 pump() 共用同一条路径。
     *
     * 抽出来是因为钩子如果绕过 quiet/paused 直接 advance，那"安静档下星空冻结"
     * 这类断言测的就是钩子自己的行为而不是真实行为 —— 结论是假的。
     * 返回 false 表示这一帧没有任何东西在动，外层该停循环了。
     */
    const stepFrame = (dt: number) => {
      const state = liveRef.current;
      if (state.quiet || state.paused || document.hidden) return false;
      advance(dt);
      return true;
    };

    const loop = (now: number) => {
      const dt = Math.min(MAX_DT, (now - last) / 1000);
      last = now;

      if (!stepFrame(dt)) {
        paint(); // 让冻结后的最终画面留在画布上，而不是停在倒数第二帧
        cancelAnimationFrame(frame);
        frame = 0;
        return;
      }

      paint();
      frame = requestAnimationFrame(loop);
    };

    const syncLoop = () => {
      const state = liveRef.current;
      if (state.quiet || state.paused || document.hidden) return;
      if (frame !== 0) return;
      /* 必须重置基准：否则重启后第一帧的 dt 是"停了多久"，计时器会白推进一大截 */
      last = performance.now();
      frame = requestAnimationFrame(loop);
    };

    const resize = () => {
      pendingResize = 0;
      if (!applyViewport()) return;
      starfield.syncView(view);

      if (Math.abs(view.aspect / lastAspect - 1) > ASPECT_REBUILD_THRESHOLD) {
        /* cap 半角跟 aspect 走，转屏必须重撒。同种子 ⇒ 新旧天空统计观感一致。 */
        starfield.rebuild(view);
      }
      lastAspect = view.aspect;

      /* 循环停着的时候（quiet / paused）改完尺寸要自己补一帧，否则画面停在旧尺寸上 */
      syncLoop();
      if (frame === 0) paint();
    };

    /* 观察 documentElement 而不是 canvas 自己：本层是 fixed inset 0，尺寸恒等于视口，
       读 window 比读元素准（clientWidth 在 fixed 元素上受滚动条影响）；而观察自己 +
       回调里直接 setSize，在移动端地址栏收放时会形成 ResizeObserver 循环。 */
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(pendingResize);
      pendingResize = requestAnimationFrame(resize);
    });
    observer.observe(document.documentElement);

    const onVisibility = () => {
      if (document.hidden) return; // 隐藏时 rAF 自己就不跑了
      /* 回来时重置基准，别把"离开多久"当成一帧的 dt 喂给自转与生成计时 */
      last = performance.now();
      syncLoop();
    };
    document.addEventListener("visibilitychange", onVisibility);

    advance(0); // 把 t=0 的漂移姿态算出来，免得第一帧与第二帧之间跳 0.4 个单位
    paint();
    syncLoop();

    controlsRef.current = {
      syncState() {
        syncLoop();
        /* 循环停着时也要重画一帧：quiet 关掉后若不补画，画面会停在冻结态 */
        if (frame === 0) paint();
      },
      applyTier(next) {
        if (next === activeTier) return;
        activeTier = next;
        /* 分档只改常量（count / twinkle），所以走"重建模块"，比在模块里维护
           一整套档位分支干净。重建在同一帧内完成：clear 之后立刻画新星，
           画布上不会有空洞。 */
        scene.remove(starfield.object);
        starfield.dispose();
        starfield = buildStarfield(next);
        scene.add(starfield.object);
        syncLoop();
        if (frame === 0) paint();
      },
    };

    if (process.env.NODE_ENV === "development") {
      /* dev 检视钩子：隐藏标签页里 rAF 不跑，只能靠 tick(dt) 手动当节拍器。
         生产构建里 NODE_ENV 被静态替换成 "production"，整个分支连同闭包一起摇树掉。 */
      (window as unknown as Record<string, unknown>).__zjSpace = {
        /** 无条件推进一帧（照 __zjButterfly.setForceFlow + tick 的思路）：
         *  用来在 quiet / paused 下也攒得出样本，不代表真实门控。 */
        tick(dt: number) {
          advance(dt);
          paint();
        },
        /** 走真实门控的一帧。测「安静档是否冻结星空 / 是否真的停了 rAF」只能用这个，不能用 tick。 */
        pump(dt: number) {
          const moved = stepFrame(dt);
          paint();
          return moved;
        },
        render: paint,
        stars: () => starfield.inspect(),
        camDrift: () => [
          Number(camera.position.x.toFixed(4)),
          Number(camera.position.y.toFixed(4)),
        ],
        stats: () => ({
          tier: activeTier,
          stars: STAR_COUNT[activeTier],
          running: frame !== 0,
          elapsed: starfield.inspect().elapsed,
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          near: SPACE_NEAR,
          far: SPACE_FAR,
          size: { w: view.width, h: view.height, dpr: view.pixelRatio },
          camera: camera.position.toArray().map((v) => Number(v.toFixed(3))),
        }),
        setQuiet: (next: boolean) => {
          liveRef.current.quiet = next;
          controlsRef.current?.syncState();
        },
        setPaused: (next: boolean) => {
          liveRef.current.paused = next;
          controlsRef.current?.syncState();
        },
        setTier: (next: RenderTier) => controlsRef.current?.applyTier(next),
        /** CSS 像素坐标、y 从顶上往下 —— 与 getBoundingClientRect 同一套约定 */
        pixelAt: (cssX: number, cssY: number) => {
          renderer.getDrawingBufferSize(bufferSize);
          const gl = renderer.getContext();
          gl.readPixels(
            Math.round(cssX * view.pixelRatio),
            Math.round(bufferSize.y - 1 - cssY * view.pixelRatio),
            1,
            1,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            readBuffer,
          );
          return [readBuffer[0], readBuffer[1], readBuffer[2]];
        },
        snapshot: () => canvas.toDataURL("image/png"),
      };
    }

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(pendingResize);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      controlsRef.current = null;
      scene.remove(starfield.object);
      starfield.dispose();
      renderer.dispose();
      canvas.remove();
      if (process.env.NODE_ENV === "development") {
        delete (window as unknown as Record<string, unknown>).__zjSpace;
      }
    };
  }, [enabled]);

  useEffect(() => {
    controlsRef.current?.syncState();
  }, [quiet, paused]);

  useEffect(() => {
    controlsRef.current?.applyTier(tierRef.current);
  }, [tier]);

  /* 不挂载 WebGL 时这个 div 依然提供 #020205 平涂 —— 静态降级与无 WebGL2 的兜底。 */
  return <div ref={hostRef} className="space-canvas" aria-hidden="true" />;
}
