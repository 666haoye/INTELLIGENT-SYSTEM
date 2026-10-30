"use client";

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { caseLibrary, type FormalCase } from "@/data/case-library";
import { getCaseSaga } from "@/data/case-sagas";
import { LAB_EXPERIMENTS, experimentHref } from "@/data/experiments";
import { buildSagaRoundPrompt } from "@/lib/case-saga";
import { resolvePageToKnowledgeTarget } from "@/lib/knowledge-links";
import type { KnowledgeTarget } from "@/lib/question-search";
import CaseSaga, { type SagaSnapshot } from "./CaseSaga";
import PanelShell from "./PanelShell";

const EXPERIMENT_BY_CODE = new Map(
  LAB_EXPERIMENTS.map((item) => [item.code, item]),
);

type CaseTab = "formal" | "micro";

const FORMAL_SEARCH = new Map(
  caseLibrary.formalCases.map((item) => [
    item.id,
    [
      item.id,
      item.title,
      item.domain,
      item.year,
      item.chapter,
      item.page,
      item.keywords.join(" "),
      item.code,
      item.options.map((option) => option.text).join(" "),
      item.problem,
      item.method,
      item.result,
      item.lesson,
    ]
      .join(" ")
      .toLowerCase(),
  ]),
);

const MICRO_SEARCH = new Map(
  caseLibrary.microCases.map((item) => [
    item.id,
    [item.id, item.concept, item.example, item.chapter].join(" ").toLowerCase(),
  ]),
);

type CaseLibraryPanelProps = {
  onClose: () => void;
  /** 从知识库卡片深链进来时先选中哪一条（case-library 的 id，如 "c01"） */
  initialCaseId?: string | null;
  onJumpToKnowledge: (target: KnowledgeTarget) => void;
  /** opts.auto 为真时，AssistantDock 会打开并直接发送（案例库错误复盘用） */
  onAskAI: (text: string, opts?: { auto?: boolean }) => void;
};

function CaseEmblem() {
  return (
    <svg viewBox="0 0 48 48" fill="none">
      <rect
        x="10"
        y="7"
        width="24"
        height="31"
        rx="3"
        stroke="currentColor"
        strokeOpacity=".38"
      />
      <path
        d="M16 16h12M16 21h12M16 26h7"
        stroke="currentColor"
        strokeOpacity=".62"
        strokeLinecap="round"
      />
      <circle cx="35" cy="34" r="6" stroke="currentColor" strokeOpacity=".5" />
      <circle cx="35" cy="34" r="2" fill="currentColor" />
      <path d="M35 25v3M35 40v3M26 34h3M41 34h3" stroke="currentColor" strokeOpacity=".35" />
    </svg>
  );
}

function CaseDetail({
  item,
  backRef,
  headingRef,
  onBack,
  onJumpToKnowledge,
  onAskAI,
}: {
  item: FormalCase;
  backRef: RefObject<HTMLButtonElement | null>;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
  onJumpToKnowledge: (target: KnowledgeTarget) => void;
  onAskAI: (text: string, opts?: { auto?: boolean }) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const [sagaSnapshot, setSagaSnapshot] = useState<SagaSnapshot | null>(null);
  const saga = getCaseSaga(item.id);
  /* 带 nonce：连点同一个错误选项也能重置提示计时器 */
  const [wrong, setWrong] = useState<{ key: string; nonce: number } | null>(
    null,
  );

  useEffect(() => {
    if (!wrong) return;
    const timer = window.setTimeout(() => setWrong(null), 2600);
    return () => window.clearTimeout(timer);
  }, [wrong]);

  const correctOption = item.options.find((o) => o.key === item.correctKey);
  const pickedOption = item.options.find((o) => o.key === pickedKey);
  const experiment = item.experimentCode
    ? EXPERIMENT_BY_CODE.get(item.experimentCode)
    : undefined;
  const canJumpPage = item.source === "flower" && item.page !== null;

  const pick = (key: string) => {
    if (revealed) return;
    setPickedKey(key);
    if (key === item.correctKey) {
      setWrong(null);
      setRevealed(true);
      return;
    }
    setWrong({ key, nonce: Date.now() });
  };

  /* 多轮案例不给答案剧透：只带当前轮的情境与问题，让老师帮忙理清权衡。
     单题案例保持原来的「我选了 X、正确答案 Y」复盘口径。 */
  const firstSagaRound = saga?.rounds[0];
  const askPrompt =
    saga && firstSagaRound
      ? buildSagaRoundPrompt({
          meta: {
            code: item.code,
            title: item.title,
            chapter: item.chapter,
            page: item.page,
          },
          round: {
            index: sagaSnapshot?.roundIndex ?? firstSagaRound.index,
            stage: sagaSnapshot?.stage ?? firstSagaRound.stage,
            brief: sagaSnapshot?.brief ?? firstSagaRound.brief,
            ask: sagaSnapshot?.ask ?? firstSagaRound.ask,
          },
          roundTotal: saga.rounds.length,
        })
      : `浩晔老师，我正在看《${item.title}》这个案例。` +
        `我刚才在情景推演里选了【${pickedOption ? pickedOption.text : "未作答"}】，` +
        `正确答案是【${correctOption ? correctOption.text : item.correctKey}】。` +
        `请结合这个案例的问题与结果，给我讲讲正确方案背后的原理，` +
        `以及为什么其他选项当年走不通。`;

  return (
    <div className="case-detail">
      <div className="case-detail-head">
        <button
          ref={backRef}
          type="button"
          className="case-back"
          onClick={onBack}
        >
          <span aria-hidden="true">←</span> 返回案例列表
        </button>
        <button
          type="button"
          className="jump-btn case-ai-btn"
          onClick={() => onAskAI(askPrompt)}
          title="打开 AI 助手并预填这个问题，确认后点发送"
        >
          🤖 让浩晔老师深入解析
        </button>
      </div>

      <p className="case-detail-kicker">
        CASE FILE · {item.code} · {item.domain} · {item.year}
      </p>
      <h3
        ref={headingRef}
        tabIndex={-1}
        className="case-detail-title"
      >
        {item.title}
      </h3>
      <p className="case-detail-meta">
        {item.chapter} <span aria-hidden="true">·</span> 印刷页码 P.{item.page ?? "—"}
        {item.source === "tensorflow" ? (
          <span className="case-source-tag">另一本教材</span>
        ) : null}
      </p>

      <ul className="case-keywords" aria-label="案例关键词">
        {item.keywords.map((keyword) => (
          <li key={keyword}>{keyword}</li>
        ))}
      </ul>

      <div className="case-sections">
        <section className="case-section">
          <p className="case-section-label">01 / 问题</p>
          <p>{item.problem}</p>
        </section>

        {saga ? (
          <CaseSaga
            saga={saga}
            item={item}
            onAskAI={onAskAI}
            onSnapshot={setSagaSnapshot}
          />
        ) : (
          <>
            <section className="case-scenario" aria-label="情景推演">
              <p className="case-section-label">情景推演</p>
              <p className="case-scenario-ask">
                当年这支团队站在岔路口，他们选的是下面哪一条？
              </p>
              <div className="case-options">
                {item.options.map((option) => {
                  const isPicked = pickedKey === option.key;
                  const isAnswer = option.key === item.correctKey;
                  const isWrongPick =
                    wrong !== null && wrong.key === option.key && !isAnswer;
                  const state = revealed
                    ? isAnswer
                      ? " is-correct"
                      : " is-locked"
                    : isWrongPick
                      ? " is-wrong"
                      : "";
                  return (
                    <button
                      key={option.key}
                      type="button"
                      className={`case-option${state}`}
                      onClick={() => pick(option.key)}
                      aria-disabled={revealed}
                      aria-pressed={isPicked}
                    >
                      <span className="case-option-key" aria-hidden="true">
                        {option.key}
                      </span>
                      <span className="case-option-text">{option.text}</span>
                      {revealed && isAnswer ? (
                        <span className="case-option-mark" aria-hidden="true">
                          ✓
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {wrong && !revealed ? (
                <p className="case-scenario-hint" role="status">
                  当年团队没这么做，再试一次？
                </p>
              ) : null}
            </section>

            {revealed ? (
              <div className="case-reveal">
                <section className="case-section">
                  <p className="case-section-label">02 / 方法</p>
                  <p>{item.method}</p>
                </section>
                <section className="case-section case-section--result">
                  <p className="case-section-label">03 / 结果</p>
                  <p>{item.result}</p>
                </section>
                <section className="case-section">
                  <p className="case-section-label">04 / 启示</p>
                  <p>{item.lesson}</p>
                </section>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="case-actions">
        {item.page === null ? (
          <span className="jump-btn kb-btn is-disabled" title="原书未单列页码">
            📖 原书未单列页码
          </span>
        ) : canJumpPage ? (
          <button
            type="button"
            className="jump-btn kb-btn"
            onClick={() => {
              const target = resolvePageToKnowledgeTarget(
                item.page as number,
              );
              if (target) onJumpToKnowledge(target);
            }}
          >
            📖 查看对应教材 P.{item.page}
          </button>
        ) : (
          <span
            className="jump-btn kb-btn is-disabled"
            title="该页码出自《TensorFlow 深度学习》，本知识库只收录了《深度学习》花书"
          >
            📖 教材 P.{item.page}（跨书，未收录）
          </span>
        )}

        {item.experimentCode ? (
          experiment ? (
            <a
              className="jump-btn exp-btn"
              href={experimentHref(experiment.id)}
              target="_blank"
              rel="noopener noreferrer"
              title={experiment.title}
            >
              🚀 运行配套沙盒实验 {item.experimentCode}
            </a>
          ) : (
            <span
              className="jump-btn exp-btn is-disabled"
              title={`实验 ${item.experimentCode} 尚未开发，目前沙盒只有 E04/E08/E11/E12/E13/E21/E22/E27/E32/E33`}
            >
              🚀 实验未开发（{item.experimentCode}）
            </span>
          )
        ) : null}
      </div>

      <p className="case-source">
        {caseLibrary.source} · 印刷页码 P.{item.page ?? "—"}
      </p>
    </div>
  );
}

export default function CaseLibraryPanel({
  onClose,
  initialCaseId,
  onJumpToKnowledge,
  onAskAI,
}: CaseLibraryPanelProps) {
  const [tab, setTab] = useState<CaseTab>("formal");
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("");
  const [track, setTrack] = useState("");
  const [selectedId, setSelectedId] = useState(
    initialCaseId || caseLibrary.formalCases[0]?.id || "",
  );
  const [detailOpen, setDetailOpen] = useState(false);

  const deferredQuery = useDeferredValue(query);
  const needle = deferredQuery.trim().toLowerCase();

  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const detailScrollRef = useRef<HTMLDivElement | null>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);

  const formalMatches = useMemo(
    () =>
      caseLibrary.formalCases.filter((item) => {
        if (track && item.track !== track) return false;
        if (
          domain &&
          item.domain !== domain &&
          !item.domain.startsWith(domain + " / ")
        ) {
          return false;
        }
        if (needle && !FORMAL_SEARCH.get(item.id)?.includes(needle)) return false;
        return true;
      }),
    [domain, needle, track],
  );

  const microMatches = useMemo(
    () =>
      caseLibrary.microCases.filter((item) => {
        if (needle && !MICRO_SEARCH.get(item.id)?.includes(needle)) return false;
        return true;
      }),
    [needle],
  );

  const selectedCase =
    formalMatches.find((item) => item.id === selectedId) ??
    formalMatches[0] ??
    null;

  /* Keep the active card aligned with the visible detail. */
  useEffect(() => {
    if (tab !== "formal" || formalMatches.length === 0) return;
    if (!formalMatches.some((item) => item.id === selectedId)) {
      setSelectedId(formalMatches[0].id);
    }
  }, [formalMatches, selectedId, tab]);

  useEffect(() => {
    if (detailScrollRef.current) detailScrollRef.current.scrollTop = 0;
  }, [selectedCase?.id]);

  useEffect(() => {
    if (!detailOpen) return;
    window.requestAnimationFrame(() => {
      detailHeadingRef.current?.focus({ preventScroll: true });
    });
  }, [detailOpen, selectedCase?.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) {
        return;
      }
      event.preventDefault();
      searchRef.current?.focus();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const selectTab = (next: CaseTab) => {
    if (next === tab) return;
    setTab(next);
    setDetailOpen(false);
  };

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next: CaseTab = tab === "formal" ? "micro" : "formal";
    setTab(next);
    setDetailOpen(false);
    window.requestAnimationFrame(() => {
      document.getElementById(`case-tab-${next}`)?.focus();
    });
  };

  const selectCase = (id: string) => {
    setSelectedId(id);
    if (window.matchMedia("(max-width: 720px)").matches) {
      setDetailOpen(true);
    }
  };

  const closeDetail = () => {
    setDetailOpen(false);
    window.requestAnimationFrame(() => {
      const active = listRef.current?.querySelector<HTMLButtonElement>(
        `[data-case-id="${selectedCase?.id ?? ""}"]`,
      );
      active?.focus({ preventScroll: true });
    });
  };

  const formalTotal = caseLibrary.formalCases.length;
  const microTotal = caseLibrary.microCases.length;
  const isFormal = tab === "formal";

  return (
    <PanelShell
      labelledBy="cases-title"
      describedBy="cases-intro"
      onClose={onClose}
      className="panel--cases"
    >
      <header className="flex flex-wrap items-start gap-6 border-b border-cyan-100/10 px-6 pb-5 pt-6 sm:px-8">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span className="panel-emblem" aria-hidden="true">
            <CaseEmblem />
          </span>
          <div className="min-w-0">
            <p className="panel-kicker">NEURAL NODE 03 / CASE LIBRARY</p>
            <h2 id="cases-title" className="panel-title">
              案例库
            </h2>
            <p id="cases-intro" className="panel-subtitle">
              {caseLibrary.kicker} · {formalTotal} 个正式案例与 {microTotal} 个教学微案例
            </p>
          </div>
        </div>

        <div className="panel-stats" aria-label="案例库统计">
          <div>
            <b>{formalTotal}</b>
            <span>正式案例</span>
          </div>
          <div>
            <b>{microTotal}</b>
            <span>教学微案例</span>
          </div>
          <div>
            <b>{caseLibrary.domains.length}</b>
            <span>领域</span>
          </div>
        </div>

        <button
          type="button"
          className="panel-close"
          aria-label="关闭案例库"
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M7 7 17 17M17 7 7 17" />
          </svg>
        </button>
      </header>

      <div className="case-toolbar">
        <div className="case-tabs" role="tablist" aria-label="案例类型">
          <button
            id="case-tab-formal"
            type="button"
            role="tab"
            aria-selected={isFormal}
            aria-controls="case-panel-formal"
            tabIndex={isFormal ? 0 : -1}
            className="case-tab"
            onClick={() => selectTab("formal")}
            onKeyDown={handleTabKeyDown}
          >
            正式案例 <span>{formalTotal}</span>
          </button>
          <button
            id="case-tab-micro"
            type="button"
            role="tab"
            aria-selected={!isFormal}
            aria-controls="case-panel-micro"
            tabIndex={isFormal ? -1 : 0}
            className="case-tab"
            onClick={() => selectTab("micro")}
            onKeyDown={handleTabKeyDown}
          >
            教学微案例 <span>{microTotal}</span>
          </button>
        </div>

        <label className="panel-search case-search" htmlFor="case-search">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="10.8" cy="10.8" r="6.2" />
            <path d="M15.4 15.4 20 20" />
          </svg>
          <input
            ref={searchRef}
            id="case-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              isFormal
                ? "搜索案例、方法、结果或关键词…"
                : "搜索概念、示例或章节…"
            }
            autoComplete="off"
            spellCheck={false}
            data-panel-autofocus
            aria-label={isFormal ? "搜索正式案例" : "搜索教学微案例"}
          />
          <kbd aria-hidden="true">/</kbd>
        </label>

        {isFormal ? (
          <>
            <label className="sr-only" htmlFor="case-domain">
              按领域筛选
            </label>
            <select
              id="case-domain"
              className="panel-select case-domain"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
            >
              <option value="">全部领域</option>
              {caseLibrary.domains.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>

            <label className="sr-only" htmlFor="case-track">
              按赛道筛选
            </label>
            <select
              id="case-track"
              className="panel-select case-domain"
              value={track}
              onChange={(event) => setTrack(event.target.value)}
            >
              <option value="">全部赛道</option>
              <option value="research">研究型案例</option>
              <option value="practice">教材实战</option>
            </select>
          </>
        ) : null}
      </div>

      <div className="case-readout">
        <p id="case-result-count" aria-live="polite">
          {isFormal
            ? formalMatches.length === formalTotal
              ? `共 ${formalTotal} 个正式案例`
              : `匹配到 ${formalMatches.length} 个正式案例`
            : microMatches.length === microTotal
              ? `共 ${microTotal} 个教学微案例`
              : `匹配到 ${microMatches.length} 个教学微案例`}
        </p>
        <p className="case-page-note">
          印刷页码 · PDF 页码 = 印刷页码 + {caseLibrary.pageOffset}
        </p>
      </div>

      {isFormal ? (
        <div
          id="case-panel-formal"
          role="tabpanel"
          aria-labelledby="case-tab-formal"
          className={`case-workspace ${detailOpen ? "is-detail-open" : ""}`}
        >
          <div className="case-list-pane" ref={listRef}>
            {formalMatches.length ? (
              formalMatches.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-case-id={item.id}
                  className={`case-list-item ${selectedCase?.id === item.id ? "is-active" : ""}`}
                  aria-pressed={selectedCase?.id === item.id}
                  onClick={() => selectCase(item.id)}
                >
                  <span className="case-item-top">
                    <span className="case-item-id">
                      {item.code}
                    </span>
                    <span className="case-item-domain">{item.domain}</span>
                    <span className="case-item-year">{item.year}</span>
                    {getCaseSaga(item.id) ? (
                      <span className="case-item-saga">多轮博弈</span>
                    ) : null}
                  </span>
                  <span className="case-item-title">{item.title}</span>
                  <span className="case-item-result">{item.result}</span>
                  <span className="case-item-meta">
                    {item.chapter} · P.{item.page ?? "—"}
                  </span>
                </button>
              ))
            ) : (
              <div className="case-empty">没有匹配的正式案例</div>
            )}
          </div>

          <div className="case-detail-pane" ref={detailScrollRef}>
            {selectedCase ? (
              <CaseDetail
                key={selectedCase.id}
                item={selectedCase}
                backRef={backRef}
                headingRef={detailHeadingRef}
                onBack={closeDetail}
                onJumpToKnowledge={onJumpToKnowledge}
                onAskAI={onAskAI}
              />
            ) : (
              <div className="case-empty">
                <p>没有匹配的案例</p>
                <span>换个关键词或清除领域筛选。</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div
          id="case-panel-micro"
          role="tabpanel"
          aria-labelledby="case-tab-micro"
          className="case-micro-scroll"
        >
          {microMatches.length ? (
            <div className="case-micro-grid">
              {microMatches.map((item) => (
                <article key={item.id} className="case-micro-card">
                  <div className="case-micro-top">
                    <span>{item.id.toUpperCase()}</span>
                    <span>概念 × 示例</span>
                  </div>
                  <h3>{item.concept}</h3>
                  <p>{item.example}</p>
                  <footer>{item.chapter}</footer>
                </article>
              ))}
            </div>
          ) : (
            <div className="case-empty">
              <p>没有匹配的教学微案例</p>
              <span>换个概念或章节关键词。</span>
            </div>
          )}
        </div>
      )}

      <footer className="panel-foot">
        <span>案例源自《深度学习》中文版</span>
        <span className="flex items-center gap-2">
          <kbd>Esc</kbd> 关闭
        </span>
      </footer>
    </PanelShell>
  );
}
