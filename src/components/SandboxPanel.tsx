"use client";

import {
  LAB_EXPERIMENTS,
  experimentHref,
} from "@/data/experiments";
import { lab3dHref } from "@/lib/lab3d/lab-routes";
import PanelShell from "./PanelShell";

type SandboxPanelProps = {
  onClose: () => void;
};

function SandboxEmblem() {
  return (
    <svg viewBox="0 0 48 48" fill="none">
      <rect
        x="8"
        y="10"
        width="32"
        height="24"
        rx="3"
        stroke="currentColor"
        strokeOpacity=".38"
      />
      <path
        d="M15 19l5 3-5 3M24 26h9"
        stroke="currentColor"
        strokeOpacity=".62"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M16 40h16" stroke="currentColor" strokeOpacity=".5" strokeLinecap="round" />
      <path
        d="M20 34v4M28 34v4"
        stroke="currentColor"
        strokeOpacity=".35"
        strokeLinecap="round"
      />
      <circle cx="35" cy="16" r="1.6" fill="currentColor" />
    </svg>
  );
}

export default function SandboxPanel({ onClose }: SandboxPanelProps) {
  const requiredCount = LAB_EXPERIMENTS.filter((item) => item.required).length;

  return (
    <PanelShell
      labelledBy="sandbox-title"
      describedBy="sandbox-intro"
      onClose={onClose}
      className="panel--sandbox"
    >
      <header className="flex flex-wrap items-start gap-6 border-b border-cyan-100/10 px-6 pb-5 pt-6 sm:px-8">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span className="panel-emblem" aria-hidden="true">
            <SandboxEmblem />
          </span>
          <div className="min-w-0">
            <p className="panel-kicker">NEURAL NODE 04 / SANDBOX LAB</p>
            <h2 id="sandbox-title" className="panel-title">
              实验沙盒
            </h2>
            <p id="sandbox-intro" className="panel-subtitle">
              10 个可在浏览器中直接运行的数字实验 · 纯原生 Canvas · 可离线打开
            </p>
          </div>
        </div>

        <div className="panel-stats" aria-label="实验沙盒统计">
          <div>
            <b>{LAB_EXPERIMENTS.length}</b>
            <span>沙盒实验</span>
          </div>
          <div>
            <b>{requiredCount}</b>
            <span>教材必做</span>
          </div>
          <div>
            <b>{LAB_EXPERIMENTS.length - requiredCount}</b>
            <span>配套设计</span>
          </div>
        </div>

        <button
          type="button"
          className="panel-close"
          aria-label="关闭实验沙盒"
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M7 7 17 17M17 7 7 17" />
          </svg>
        </button>
      </header>

      <div className="sandbox-body">
        <p className="sandbox-note">
          点击任意实验卡片，在新标签页打开独立实验页；每页标注教材章节 ·
          印刷页码 ·「🏷️ 教材必做」或「配套设计」。带
          <span className="sandbox-note-3d"> ✨ 3D 沉浸模式</span>
          标记的实验最值得升级成 3D 场景，把鼠标移到卡片上可看到它的形态说明。
        </p>

        <div className="sandbox-grid">
          {LAB_EXPERIMENTS.map((item, index) => {
            /* 一张卡上有两个跳转目标（静态 2D 实验页 / React 3D 场景），而 `<a>` 里不能再套
               `<a>` 或 `<button>` —— 交互式内容嵌套既不合法也让读屏犯迷糊。
               所以卡片本体退回 `<div>`，主跳转用铺满整卡的 stretched link，
               角标是自己的 `<a>`，靠 z-index 抢在整卡之前接住点击。 */
            const href3d = lab3dHref(item.id);
            return (
              <div className="sandbox-card" key={item.id}>
                <a
                  className="sandbox-card-main"
                  href={experimentHref(item.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={item.form}
                  {...(index === 0 ? { "data-panel-autofocus": "" } : {})}
                >
                  <span className="sandbox-card-top">
                    <span className="sandbox-card-code">{item.code}</span>
                    <span
                      className={
                        "sandbox-card-tag" + (item.required ? " is-required" : "")
                      }
                    >
                      {item.required ? "🏷️ 教材必做" : "配套设计"}
                    </span>
                  </span>

                  <span className="sandbox-card-title">{item.title}</span>

                  <span className="sandbox-card-source">
                    {item.chapter} · 印刷页 P.{item.page}
                  </span>

                  <span className="sandbox-card-purpose">{item.purpose}</span>

                  <span className="sandbox-card-go" aria-hidden="true">
                    运行实验 <span className="sandbox-card-arrow">↗</span>
                  </span>
                </a>

                {item.threeD === "high" ? (
                  href3d ? (
                    <a
                      className="sandbox-card-3d is-link"
                      href={href3d}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`在新标签打开 ${item.code} 的 3D 沉浸场景`}
                    >
                      ✨ 3D 沉浸模式 <span aria-hidden="true">↗</span>
                    </a>
                  ) : (
                    /* 适配度高但场景还没做出来：保留标签、不给链接，免得点出 404。 */
                    <span className="sandbox-card-3d">✨ 3D 沉浸模式</span>
                  )
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </PanelShell>
  );
}
