"use client";

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  knowledgeBase,
  type KnowledgeChapter,
  type KnowledgePoint,
} from "@/data/knowledge-base";
import PanelShell from "./PanelShell";
import { experimentHref } from "@/data/experiments";
import { EXPERIMENTS_BY_POINT } from "@/lib/knowledge-links";
import type { KnowledgeTarget } from "@/lib/question-search";

const SEARCH_TEXT = new Map(
  knowledgeBase.points.map((point) => [
    point.id,
    [
      point.part,
      point.chapter,
      point.section,
      point.summary,
      point.terms.join(" "),
      point.page,
      point.chapterPages,
    ]
      .join(" ")
      .toLowerCase(),
  ]),
);

const CHAPTER_INDEX = new Map(
  knowledgeBase.chapters.map((chapter, index) => [chapter.name, index]),
);

type KnowledgePanelProps = {
  onClose: () => void;
  initialTarget?: KnowledgeTarget | null;
  onBackToProblem?: () => void;
};

type ChapterGroup = {
  chapter: KnowledgeChapter;
  points: KnowledgePoint[];
};

/* 只有章节号能对上的知识点才出按钮：169 条里恰好 10 条。 */
function PointExperiments({ pointId }: { pointId: number }) {
  const experiments = EXPERIMENTS_BY_POINT.get(pointId);
  if (!experiments || experiments.length === 0) return null;

  return (
    <div className="kb-item-actions">
      {experiments.map((experiment) => (
        <a
          key={experiment.id}
          className="jump-btn exp-btn"
          href={experimentHref(experiment.id)}
          target="_blank"
          rel="noopener noreferrer"
          title={experiment.title}
        >
          🚀 运行对应实验 {experiment.code}
        </a>
      ))}
    </div>
  );
}

export default function KnowledgePanel({
  onClose,
  initialTarget = null,
  onBackToProblem,
}: KnowledgePanelProps) {
  const targetChapter = initialTarget?.chapter ?? "";
  const targetPart =
    knowledgeBase.chapters.find((item) => item.name === targetChapter)?.part ??
    "";

  const [query, setQuery] = useState("");
  const [part, setPart] = useState(targetPart);
  const [chapter, setChapter] = useState(targetChapter);
  const deferredQuery = useDeferredValue(query);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  const chapterOptions = useMemo(
    () =>
      knowledgeBase.chapters.filter(
        (item) => !part || item.part === part,
      ),
    [part],
  );

  const matches = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return knowledgeBase.points.filter((point) => {
      if (part && point.part !== part) return false;
      if (chapter && point.chapter !== chapter) return false;
      if (needle && !SEARCH_TEXT.get(point.id)?.includes(needle)) return false;
      return true;
    });
  }, [chapter, deferredQuery, part]);

  const groups = useMemo<ChapterGroup[]>(() => {
    const byChapter = new Map<string, KnowledgePoint[]>();
    for (const point of matches) {
      const existing = byChapter.get(point.chapter);
      if (existing) existing.push(point);
      else byChapter.set(point.chapter, [point]);
    }

    return knowledgeBase.chapters
      .map((item) => ({
        chapter: item,
        points: byChapter.get(item.name) ?? [],
      }))
      .filter((group) => group.points.length > 0);
  }, [matches]);

  useEffect(() => {
    if (!initialTarget) return;
    const scroller = resultsRef.current;
    if (!scroller) return;

    const chapterIndex = CHAPTER_INDEX.get(initialTarget.chapter);
    const selector = initialTarget.pointId
      ? `#kb-point-${initialTarget.pointId}`
      : `#kb-chapter-group-${chapterIndex ?? 0}`;
    const target = scroller.querySelector<HTMLElement>(selector);
    if (!target) return;

    target.classList.add("is-jump-target");

    if (initialTarget.pointId) {
      target.scrollIntoView({ block: "center", behavior: "auto" });
    } else {
      /* Chapter targets are taller than the viewport: align the chapter head. */
      const offset =
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      scroller.scrollTop = Math.max(0, offset - 2);
    }

    const focusTimer = window.setTimeout(() => {
      target.focus({ preventScroll: true });
    }, 90);
    const clearTimer = window.setTimeout(() => {
      target.classList.remove("is-jump-target");
    }, 2800);

    return () => {
      window.clearTimeout(focusTimer);
      window.clearTimeout(clearTimer);
      target.classList.remove("is-jump-target");
    };
  }, [initialTarget]);

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

  const handlePartChange = (value: string) => {
    setPart(value);
    if (chapter) {
      const selected = knowledgeBase.chapters.find(
        (item) => item.name === chapter,
      );
      if (!selected || (value && selected.part !== value)) setChapter("");
    }
  };

  const resetFilters = () => {
    setQuery("");
    setPart("");
    setChapter("");
    window.requestAnimationFrame(() => searchRef.current?.focus());
  };

  const total = knowledgeBase.points.length;
  const hasFilters = Boolean(query.trim() || part || chapter);

  return (
    <PanelShell
      labelledBy="knowledge-title"
      describedBy="knowledge-intro"
      onClose={onClose}
      className="panel--knowledge"
    >
      <header className="flex flex-wrap items-start gap-6 border-b border-cyan-100/10 px-6 pb-5 pt-6 sm:px-8">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span className="panel-emblem" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="17" stroke="currentColor" strokeOpacity=".18" />
              <circle
                cx="24"
                cy="24"
                r="11"
                stroke="currentColor"
                strokeOpacity=".42"
                strokeDasharray="1 4"
              />
              <circle cx="24" cy="24" r="4.5" fill="currentColor" fillOpacity=".9" />
              <circle cx="24" cy="7" r="1.5" fill="currentColor" />
              <circle cx="41" cy="24" r="1.5" fill="currentColor" />
            </svg>
          </span>

          <div className="min-w-0">
            <p className="panel-kicker">NEURAL NODE 01 / KNOWLEDGE</p>
            <h2 id="knowledge-title" className="panel-title">
              知识库
            </h2>
            <p id="knowledge-intro" className="panel-subtitle">
              《深度学习》花书 · {knowledgeBase.chapters.length} 章核心知识索引
            </p>
          </div>
        </div>

        <div className="panel-stats" aria-label="知识库统计">
          <div>
            <b>{knowledgeBase.parts.length}</b>
            <span>大部分</span>
          </div>
          <div>
            <b>{knowledgeBase.chapters.length}</b>
            <span>章</span>
          </div>
          <div>
            <b>{total}</b>
            <span>知识点</span>
          </div>
        </div>

        <button
          type="button"
          className="panel-close"
          aria-label="关闭知识库"
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M7 7 17 17M17 7 7 17" />
          </svg>
        </button>
      </header>

      {onBackToProblem ? (
        <div className="knowledge-return-bar">
          <button type="button" className="knowledge-return" onClick={onBackToProblem}>
            <span aria-hidden="true">←</span> 返回问题
          </button>
          {initialTarget?.query ? (
            <span className="knowledge-return-query">{initialTarget.query}</span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 px-6 pt-4 sm:flex-row sm:px-8">
        <label className="panel-search" htmlFor="knowledge-search">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="10.8" cy="10.8" r="6.2" />
            <path d="M15.4 15.4 20 20" />
          </svg>
          <input
            ref={searchRef}
            id="knowledge-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索章节、知识点、术语或页码…"
            autoComplete="off"
            spellCheck={false}
            data-panel-autofocus
            aria-label="搜索知识库"
          />
          <kbd aria-hidden="true">/</kbd>
        </label>

        <div className="flex gap-2">
          <label className="sr-only" htmlFor="knowledge-part">
            按部分筛选
          </label>
          <select
            id="knowledge-part"
            className="panel-select min-w-0 flex-1"
            value={part}
            onChange={(event) => handlePartChange(event.target.value)}
          >
            <option value="">全部部分</option>
            {knowledgeBase.parts.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor="knowledge-chapter">
            按章节筛选
          </label>
          <select
            id="knowledge-chapter"
            className="panel-select min-w-0 flex-1"
            value={chapter}
            onChange={(event) => setChapter(event.target.value)}
          >
            <option value="">全部章节</option>
            {chapterOptions.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1 px-6 pb-2 pt-3 text-[10px] tracking-[0.14em] sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p id="knowledge-result-count" className="text-sky-100/65" aria-live="polite">
          {matches.length === total
            ? `共 ${total} 个知识点`
            : `匹配到 ${matches.length} 个知识点`}
        </p>
        <p className="text-[8.5px] text-sky-100/35 sm:text-[9.5px]">
          印刷页码 · PDF 页码 = 印刷页码 + {knowledgeBase.pdfOffset}
        </p>
      </div>

      <div
        ref={resultsRef}
        className="kb-scroll"
        role="region"
        aria-label="知识库条目"
        tabIndex={0}
      >
        {groups.length > 0 ? (
          groups.map(({ chapter: item, points }) => {
            const index = CHAPTER_INDEX.get(item.name) ?? 0;
            return (
              <section
                key={item.name}
                id={`kb-chapter-group-${index}`}
                className="kb-chapter"
                aria-labelledby={`kb-chapter-${index}`}
                tabIndex={-1}
              >
                <header className="kb-chapter-head">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <p className="kb-chapter-part">{item.part}</p>
                    <h3 id={`kb-chapter-${index}`} className="kb-chapter-title">
                      {item.name}
                    </h3>
                    <span className="kb-chapter-pages">P.{item.pages}</span>
                    <span className="ml-auto text-[9px] tracking-[0.12em] text-sky-100/35">
                      {points.length} 条
                    </span>
                  </div>
                  {item.description ? (
                    <p className="kb-chapter-desc">{item.description}</p>
                  ) : null}
                </header>

                <div>
                  {points.map((point) => (
                    <article
                      key={point.id}
                      id={`kb-point-${point.id}`}
                      className="kb-item"
                      tabIndex={-1}
                    >
                      <div className="kb-page">
                        <span>P</span>
                        {point.page}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-baseline justify-between gap-3">
                          <h4 className="kb-item-title">{point.section}</h4>
                          <span className="kb-item-id">
                            #{String(point.id).padStart(3, "0")}
                          </span>
                        </div>
                        <p className="kb-item-summary">{point.summary}</p>
                        {point.terms.length ? (
                          <ul className="kb-terms" aria-label="关键术语">
                            {point.terms.map((term) => (
                              <li key={term}>{term}</li>
                            ))}
                          </ul>
                        ) : null}
                        <PointExperiments pointId={point.id} />
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })
        ) : (
          <div className="kb-empty">
            <span className="kb-empty-orb" aria-hidden="true" />
            <p>没有匹配的知识点</p>
            <span>
              {hasFilters ? "换个关键词，或清除筛选条件。" : "从左侧选择章节开始浏览。"}
            </span>
            <button type="button" className="kb-reset" onClick={resetFilters}>
              清除筛选
            </button>
          </div>
        )}
      </div>

      <footer className="panel-foot">
        <span>依据《深度学习》（花书）中文版整理</span>
        <span className="flex items-center gap-2">
          <kbd>Esc</kbd> 关闭
        </span>
      </footer>
    </PanelShell>
  );
}
