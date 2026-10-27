"use client";

import type { ModuleNode } from "@/lib/nodes";
import PanelShell from "./PanelShell";

type PlaceholderPanelProps = {
  node: ModuleNode;
  onClose: () => void;
};

export default function PlaceholderPanel({
  node,
  onClose,
}: PlaceholderPanelProps) {
  const titleId = `module-title-${node.id}`;
  const descriptionId = `module-description-${node.id}`;

  return (
    <PanelShell
      labelledBy={titleId}
      describedBy={descriptionId}
      onClose={onClose}
      className="panel--placeholder"
    >
      <header className="flex items-start justify-between gap-5 border-b border-cyan-100/10 px-6 pb-5 pt-6 sm:px-8">
        <div>
          <p className="panel-kicker">{node.eyebrow}</p>
          <h2 id={titleId} className="panel-title panel-title--small">
            {node.title}
          </h2>
        </div>
        <button
          type="button"
          className="panel-close"
          aria-label={`关闭${node.title}面板`}
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M7 7 17 17M17 7 7 17" />
          </svg>
        </button>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-8 py-10 text-center">
        <div className="placeholder-orbit" aria-hidden="true">
          <span className="placeholder-orbit__ring" />
          <span className="placeholder-orbit__core" />
          <span className="placeholder-orbit__dot placeholder-orbit__dot--a" />
          <span className="placeholder-orbit__dot placeholder-orbit__dot--b" />
        </div>

        <p className="mb-2 mt-7 text-[9px] uppercase tracking-[0.34em] text-sky-300/40">
          Neural module {node.index}
        </p>
        <p
          id={descriptionId}
          className="max-w-[30rem] text-sm leading-7 text-sky-100/60"
        >
          {node.blurb}
        </p>

        <div className="placeholder-status">
          <span className="placeholder-status__dot" aria-hidden="true" />
          功能接入中 · 当前为占位面板
        </div>

        <button
          type="button"
          className="panel-action mt-8"
          onClick={onClose}
          data-panel-autofocus
        >
          返回蝴蝶
        </button>
      </div>

      <footer className="panel-foot">
        <span>节点 {node.index} / 四翼神经元</span>
        <span className="flex items-center gap-2">
          <kbd>Esc</kbd> 关闭
        </span>
      </footer>
    </PanelShell>
  );
}
