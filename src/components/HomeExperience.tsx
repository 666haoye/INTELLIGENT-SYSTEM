"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import AssistantDock from "./AssistantDock";
import CaseLibraryPanel from "./CaseLibraryPanel";
import FieldCanvas from "./FieldCanvas";
import KnowledgePanel from "./KnowledgePanel";
import LinkNetwork from "./LinkNetwork";
import PlaceholderPanel from "./PlaceholderPanel";
import ProblemPanel from "./ProblemPanel";
import SandboxPanel from "./SandboxPanel";
import TrailsCanvas, { type TrailTarget } from "./TrailsCanvas";
import WingNode from "./WingNode";
import {
  getTrailCount,
  readStoredFlag,
  shouldUseStaticFallback,
  writeStoredFlag,
  type RenderTier,
} from "@/lib/environment";
import {
  MODULE_NODES,
  NODE_BY_ID,
  type ModuleNode,
  type NodeId,
  type WingSide,
} from "@/lib/nodes";
import type { KnowledgeTarget } from "@/lib/question-search";

const QUIET_KEY = "zj.next.quiet";

/* Three.js 只在客户端加载：蝴蝶是纯装饰层，不能进首屏关键路径，
   也不需要服务端渲染（SSR 下会直接渲染 loading 占位，这里是 null）。 */
const ButterflyScene = dynamic(() => import("./ButterflyScene"), {
  ssr: false,
  loading: () => null,
});

type SceneApi = {
  focus(node: NodeId): void;
  beginReturn(): void;
  skip(to: "locked" | "idle"): void;
};

function BrandMark() {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className="brand-mark"
      aria-hidden="true"
    >
      <path d="M16 16.6C12.4 8.4 5.1 6.6 4.6 11c-.6 4.6 5 7.3 11.4 5.6Z" />
      <path d="M16 16.6C19.6 8.4 26.9 6.6 27.4 11c.6 4.6-5 7.3-11.4 5.6Z" />
      <path d="M16 16.6C14.2 21.4 10.5 26 12.2 27.8c1.8 1.8 3.5-4.4 3.8-11.2Z" />
      <path d="M16 16.6C17.8 21.4 21.5 26 19.8 27.8c-1.8 1.8-3.5-4.4-3.8-11.2Z" />
      <path d="M16 13.6v6.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M13.4 8.1A5.5 5.5 0 1 0 17.9 15.6 4.7 4.7 0 0 1 13.4 8.1Z" />
    </svg>
  );
}

export default function HomeExperience() {
  const [quiet, setQuiet] = useState(false);
  const [isStatic, setIsStatic] = useState(false);
  const [pagePaused, setPagePaused] = useState(false);
  const [hoveredSide, setHoveredSide] = useState<WingSide | null>(null);
  const [hoveredId, setHoveredId] = useState<NodeId | null>(null);
  /* 档位由 3D 层判定后回传；null 表示还没定，此时不加 is-flagship */
  const [renderTier, setRenderTier] = useState<RenderTier | null>(null);
  const [litPulse, setLitPulse] = useState<{ side: WingSide; key: number } | null>(null);
  /* Nodes activated by trails: their links light up until a panel opens. */
  const [armedIds, setArmedIds] = useState<NodeId[]>([]);
  const [compact, setCompact] = useState(false);
  const [activeId, setActiveId] = useState<NodeId | null>(null);
  const [aiDockOpen, setAiDockOpen] = useState(false);
  const [aiPrefill, setAiPrefill] = useState<{
    text: string;
    nonce: number;
  } | null>(null);
  const [knowledgeTarget, setKnowledgeTarget] = useState<KnowledgeTarget | null>(null);
  const [knowledgeFromProblem, setKnowledgeFromProblem] = useState(false);
  const [problemReturnQuery, setProblemReturnQuery] = useState("");
  const [trailCount, setTrailCount] = useState(4);

  const contentRef = useRef<HTMLDivElement | null>(null);
  const sceneApi = useRef<SceneApi | null>(null);
  /* 点击后先记下要开哪个面板，等 3D 时序（推镜→光路→保持）走完再真的开 */
  const pendingOpen = useRef<{ node: ModuleNode; trigger: HTMLButtonElement | null } | null>(null);
  const nodeRefs = useRef<Partial<Record<NodeId, HTMLButtonElement>>>({});
  const nodeTimers = useRef<Partial<Record<NodeId, number>>>({});
  const nearTimers = useRef<Partial<Record<NodeId, number>>>({});
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);
  const hadPanelRef = useRef(false);

  /* Load saved preferences, then auto-detect weak network / reduced motion. */
  useEffect(() => {
    const savedQuiet = readStoredFlag(QUIET_KEY);
    if (savedQuiet !== null) setQuiet(savedQuiet);

    if (shouldUseStaticFallback()) setIsStatic(true);
  }, []);

  /* Keep the trail budget responsive and cheap on phones. */
  useEffect(() => {
    const update = () => setTrailCount(getTrailCount());
    update();
    window.addEventListener("resize", update, { passive: true });
    return () => window.removeEventListener("resize", update);
  }, []);

  /* Phones simplify the link animation (no stagger, fewer decorations). */
  useEffect(() => {
    const query = window.matchMedia("(max-width: 640px)");
    const sync = () => setCompact(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  /* Page blur / hidden tab pauses both CSS and canvas animation. */
  useEffect(() => {
    const sync = () => setPagePaused(document.hidden || !document.hasFocus());
    sync();
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  useEffect(() => {
    return () => {
      Object.values(nodeTimers.current).forEach((timer) => {
        if (timer) window.clearTimeout(timer);
      });
      Object.values(nearTimers.current).forEach((timer) => {
        if (timer) window.clearTimeout(timer);
      });
    };
  }, []);

  const toggleQuiet = () => {
    setQuiet((current) => {
      const next = !current;
      writeStoredFlag(QUIET_KEY, next);
      return next;
    });
  };

  const registerNode = useCallback(
    (id: NodeId, element: HTMLButtonElement | null) => {
      if (element) nodeRefs.current[id] = element;
      else delete nodeRefs.current[id];
    },
    [],
  );

  const getTargets = useCallback((): TrailTarget[] => {
    return MODULE_NODES.map((node) => {
      const element = nodeRefs.current[node.id];
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        id: node.id,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }).filter((target): target is TrailTarget => target !== null);
  }, []);

  const flashNode = useCallback((id: NodeId) => {
    const element = nodeRefs.current[id];
    if (!element) return;

    element.classList.remove("is-lit");
    void element.offsetWidth;
    element.classList.add("is-lit", "is-armed");
    setArmedIds((previous) => (previous.includes(id) ? previous : [...previous, id]));
    setLitPulse((previous) => ({
      side: NODE_BY_ID[id].side,
      key: (previous?.key ?? 0) + 1,
    }));

    window.clearTimeout(nodeTimers.current[id]);
    nodeTimers.current[id] = window.setTimeout(() => {
      element.classList.remove("is-lit");
    }, 1000);
  }, []);

  /* A trail is passing close by: nudge the node bigger and brighter. */
  const pulseNode = useCallback((id: NodeId) => {
    const element = nodeRefs.current[id];
    if (!element) return;

    element.classList.remove("is-near");
    void element.offsetWidth;
    element.classList.add("is-near");

    window.clearTimeout(nearTimers.current[id]);
    nearTimers.current[id] = window.setTimeout(() => {
      element.classList.remove("is-near");
    }, 520);
  }, []);

  const handleHoverChange = useCallback((node: ModuleNode | null) => {
    setHoveredSide(node?.side ?? null);
    setHoveredId(node?.id ?? null);
  }, []);

  /* 点击节点：不立刻开面板，先点亮 3D 的聚焦时序（约 1.3s），到位后才转场 */
  const requestOpen = useCallback((node: ModuleNode, trigger: HTMLButtonElement | null) => {
    if (pendingOpen.current) return;
    pendingOpen.current = { node, trigger };
    sceneApi.current?.focus(node.id);
  }, []);

  const handleTransitionReady = useCallback((nodeId: NodeId) => {
    const pending = pendingOpen.current;
    pendingOpen.current = null;
    if (!pending || pending.node.id !== nodeId) return;
    /* 延后到这里才执行原有关面板逻辑：inert、焦点回归都不变 */
    openPanelRef.current?.(pending.node, pending.trigger);
  }, []);

  /* openPanel 在下面定义，用 ref 避免把 transition 回调卷进它的依赖 */
  const openPanelRef = useRef<((node: ModuleNode, trigger: HTMLButtonElement | null) => void) | null>(
    null,
  );

  const openPanel = useCallback(
    (node: ModuleNode, trigger: HTMLButtonElement | null) => {
      lastTriggerRef.current = trigger;
      setHoveredSide(null);
      setHoveredId(null);
      setKnowledgeTarget(null);
      setKnowledgeFromProblem(false);
      if (node.id === "problem") setProblemReturnQuery("");
      setActiveId(node.id);

      /* The guidance promise is fulfilled: disarm every node, drop the hint. */
      Object.values(nodeRefs.current).forEach((element) => {
        element?.classList.remove("is-armed");
      });
      setArmedIds([]);
    },
    [],
  );
  openPanelRef.current = openPanel;

  const closePanel = useCallback(() => {
    /* 面板立即关，3D 在背后逆向收尾：拉回 → 光路溶解 → 重启呼吸 */
    sceneApi.current?.beginReturn();
    setActiveId(null);
    setKnowledgeTarget(null);
    setKnowledgeFromProblem(false);
  }, []);

  const jumpToKnowledge = useCallback(
    (target: KnowledgeTarget, query: string) => {
      /* 深链不走点击时序，直接落位，否则知识库跳转要被 choreography 卡 1.3s */
      sceneApi.current?.skip("idle");
      setProblemReturnQuery(query);
      setKnowledgeTarget(target);
      setKnowledgeFromProblem(true);
      setActiveId("knowledge");
    },
    [],
  );

  /* 通用「按定位目标打开知识库」入口：AI 助手与案例库共用。
     不置 knowledgeFromProblem，否则知识库会显示无意义的「返回问题」条，
     因此不能复用上面的 jumpToKnowledge。 */
  const openKnowledgeAt = useCallback((target: KnowledgeTarget) => {
    sceneApi.current?.skip("idle");
    setKnowledgeTarget(target);
    setKnowledgeFromProblem(false);
    setActiveId("knowledge");
  }, []);

  const askAI = useCallback((text: string) => {
    sceneApi.current?.skip("idle");
    setAiPrefill({ text, nonce: Date.now() });
    setAiDockOpen(true);
  }, []);

  const backToProblem = useCallback(() => {
    setKnowledgeTarget(null);
    setKnowledgeFromProblem(false);
    setActiveId("problem");
  }, []);

  /* Remove the page from the accessibility tree while a panel is open. */
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    if (activeId) {
      content.setAttribute("inert", "");
      content.setAttribute("aria-hidden", "true");
    } else {
      content.removeAttribute("inert");
      content.removeAttribute("aria-hidden");
    }

    return () => {
      content.removeAttribute("inert");
      content.removeAttribute("aria-hidden");
    };
  }, [activeId]);

  /* Return focus to the node that opened the panel. */
  useEffect(() => {
    if (hadPanelRef.current && !activeId) {
      const trigger = lastTriggerRef.current;
      window.requestAnimationFrame(() => {
        if (trigger && document.contains(trigger)) {
          trigger.focus({ preventScroll: true });
        }
      });
    }
    hadPanelRef.current = Boolean(activeId);
  }, [activeId]);

  const rootClass = [
    "home-root",
    quiet ? "is-quiet" : "",
    isStatic ? "is-static" : "",
    pagePaused ? "is-paused" : "",
    activeId ? "is-panel-open" : "",
    /* 旗舰档有环绕运镜，必须关掉 .butterfly-float 的 CSS 浮动，否则两种运动叠加会晕 */
    renderTier === "flagship" ? "is-flagship" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const tempo = quiet ? 1.65 : 1;
  const stageStatic = isStatic || quiet;
  const activeNode = activeId ? NODE_BY_ID[activeId] : null;
  const stageFlowOn = !stageStatic && !pagePaused && !activeId;

  return (
    <div className={rootClass}>
      <div ref={contentRef} className="home-content">
        <div className="site-bg" aria-hidden="true" />
        <FieldCanvas enabled={!stageStatic} />
        <div className="site-vignette" aria-hidden="true" />

        <TrailsCanvas
          enabled={!stageStatic}
          paused={pagePaused || Boolean(activeId)}
          quiet={quiet}
          count={trailCount}
          getTargets={getTargets}
          onNodeLit={flashNode}
          onNodeNear={pulseNode}
        />

        <header className="site-header">
          <div className="brand">
            <BrandMark />
            <span className="brand-name">深度学习智慧教育系统</span>
          </div>

          <div className="header-actions">
            <button
              type="button"
              className="control-button"
              aria-pressed={quiet}
              onClick={toggleQuiet}
              title={quiet ? "恢复默认发光与动效" : "关闭全部特效，降级为静态蝴蝶"}
            >
              <span className="control-icon">
                <MoonIcon />
              </span>
              <span>安静模式</span>
              <span className="control-dot" aria-hidden="true" />
            </button>
          </div>
        </header>

        <main className="butterfly-stage">
          <h1 className="sr-only">智教系统 · 全息学习空间</h1>

          <div className="butterfly-center">
            <div className="butterfly-float">
              <ButterflyScene
                hoveredSide={hoveredSide}
                hoveredId={hoveredId}
                flowOn={stageFlowOn}
                tempo={tempo}
                litPulse={litPulse}
                glow={quiet ? 0.55 : 1}
                hardLock={isStatic || quiet}
                onTierDecided={setRenderTier}
                onTransitionReady={handleTransitionReady}
                sceneApiRef={sceneApi}
              />

              <LinkNetwork armedIds={armedIds} compact={compact} />

              <div className="wing-node-layer">
                {MODULE_NODES.map((node) => (
                  <WingNode
                    key={node.id}
                    node={node}
                    onOpen={requestOpen}
                    onHoverChange={handleHoverChange}
                    registerRef={registerNode}
                  />
                ))}

                {/* Center orb: opens the in-page AI assistant dock. */}
                <button
                  type="button"
                  className="core-trigger"
                  onClick={() => setAiDockOpen(true)}
                  aria-label="打开 AI 助手"
                  aria-expanded={aiDockOpen}
                  title="AI 助手"
                >
                  <span className="core-trigger__ring" aria-hidden="true" />
                </button>
              </div>

              <p
                className={`core-hint${(armedIds.length > 0 || stageStatic) && !activeId ? " is-visible" : ""}`}
                aria-live="polite"
              >
                点击节点，进入学习系统
              </p>
            </div>
          </div>
        </main>

        <footer className="site-footer">
          <p className="footer-hint">
            四枚翼上神经元
            <span className="footer-sep" aria-hidden="true" />
            轻触唤醒学习模块
          </p>
        </footer>
      </div>

      {/* 必须挂在 .home-content 之外：inert 副作用作用于 .home-content，
          放在里面的话面板一打开悬浮按钮就点不动了；而 kb:// 跳转恰恰会打开面板。 */}
      <AssistantDock
        open={aiDockOpen}
        onOpenChange={setAiDockOpen}
        onJumpToKnowledge={openKnowledgeAt}
        prefill={aiPrefill}
      />

      {activeNode ? (
        activeNode.mode === "problem" ? (
          <ProblemPanel
            initialQuery={problemReturnQuery}
            onJumpToKnowledge={jumpToKnowledge}
            onClose={closePanel}
          />
        ) : activeNode.mode === "knowledge" ? (
          <KnowledgePanel
            initialTarget={knowledgeTarget}
            onBackToProblem={knowledgeFromProblem ? backToProblem : undefined}
            onClose={closePanel}
          />
        ) : activeNode.mode === "cases" ? (
          <CaseLibraryPanel
            onClose={closePanel}
            onJumpToKnowledge={openKnowledgeAt}
            onAskAI={askAI}
          />
        ) : activeNode.mode === "sandbox" ? (
          <SandboxPanel onClose={closePanel} />
        ) : (
          <PlaceholderPanel node={activeNode} onClose={closePanel} />
        )
      ) : null}
    </div>
  );
}
