"use client";

import {
  memo,
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
import { kbImages } from "@/data/kb-data";
import { CONCEPT_BY_POINT } from "@/data/kb-concepts";
import PanelShell from "./PanelShell";
import KbImageTabs from "./KbImageTabs";
import { experimentHref } from "@/data/experiments";
import { LAB_BY_POINT } from "@/lib/knowledge-links";
import { kbImagesForPoint } from "@/lib/kb-images";
import type { KnowledgeTarget } from "@/lib/question-search";

/* 搜索用的拼接文本：章名、节号、标题、括注正文、术语、两种页码口径都进去，
   这样输 "P.223" 和输 "Dropout" 都能命中同一条。 */
const SEARCH_TEXT = new Map(
  knowledgeBase.points.map((point) => [
    point.id,
    [
      point.part,
      (point.chapters ?? [point.chapter]).join(" "),
      point.section,
      point.name ?? "",
      point.summary,
      point.terms.join(" "),
      /* 卡片上印的是「P.223」，就该能照原样搜到；只存裸数字会逼用户猜格式。 */
      (point.pages ?? [point.page]).map((page) => `P.${page}`).join(" "),
      (point.pages ?? [point.page]).join(" "),
      (point.pages ?? [point.page])
        .map((page) => page + knowledgeBase.pdfOffset)
        .join(" "),
      point.chapterPages,
    ]
      .join(" ")
      .toLowerCase(),
  ]),
);

const CHAPTER_INDEX = new Map(
  knowledgeBase.chapters.map((chapter, index) => [chapter.name, index]),
);

const POINT_BY_ID = new Map(
  knowledgeBase.points.map((point) => [point.id, point]),
);

/*
 * 全应用只有一套编号：question-index.ts 那份冻结的旧 169 编号快照，
 * 在 searchKnowledge 的出口就已经翻译过了（见 knowledge-links.ts 的 toCurrentTarget）。
 * 所以这里只需要按 id 直查，不需要再猜来的是新编号还是旧编号。
 */

/* 带切片的条目数。模块级算一次：288 次 Map 查找，换掉头部那个会说谎的统计位。 */
const PLATE_COUNT = knowledgeBase.points.filter(
  (point) => kbImagesForPoint(point.id).length > 0,
).length;

const REL_CLASS: Record<string, string> = {
  高: "kbw-rel--high",
  中: "kbw-rel--mid",
  低: "kbw-rel--low",
};

type KnowledgePanelProps = {
  onClose: () => void;
  initialTarget?: KnowledgeTarget | null;
  onBackToProblem?: () => void;
  /** 「📁 查看实战案例 Cxx」：切到案例库面板并选中那一个案例（传 case-library 的 id，如 "c01"） */
  onOpenCase: (caseId: string) => void;
};

type ChapterGroup = {
  chapter: KnowledgeChapter;
  points: KnowledgePoint[];
};

type PendingJump = {
  kind: "point" | "chapter";
  selector: string;
};

/* ---------- 条目卡：288 条共用一套，带切片的额外叠深度解读和图栏 ---------- */

/* 288 张卡里有 184 张带切片台，一张都不能白重渲染。父层 HomeExperience 在 hover 计时、
   邻近判定、跳转时序这些跟知识库内容无关的地方 setState，会一路传到面板；
   没有 memo 就是 288 张卡（含 184 个 KbImageTabs）跟着全量重算一遍。
   props 天然稳定：point 是模块级数据里的同一对象，pdfOffset 是常量，
   onOpenCase 在 HomeExperience 里是 useCallback(…, [])。 */
const PointCard = memo(function PointCard({
  point,
  pdfOffset,
  onOpenCase,
}: {
  point: KnowledgePoint;
  pdfOffset: number;
  onOpenCase: (caseId: string) => void;
}) {
  const concept = CONCEPT_BY_POINT.get(point.id);
  const images = kbImagesForPoint(point.id);
  const links = LAB_BY_POINT.get(point.id);
  const pages = point.pages ?? [point.page];
  const alsoChapters = (point.chapters ?? []).filter(
    (name) => name !== point.chapter,
  );
  const heading = point.name || point.section || point.summary;

  return (
    <article
      id={`kb-point-${point.id}`}
      className={`kbw-point${concept ? " kbw-point--featured" : ""}`}
      tabIndex={-1}
      aria-labelledby={`kb-point-title-${point.id}`}
    >
      <div className="kbw-point-page">
        <span>P</span>
        {point.page}
        <em className="kbw-pdfpage">PDF {point.page + pdfOffset}</em>
      </div>

      <div className="min-w-0">
        <div className="kbw-point-head">
          <h4 id={`kb-point-title-${point.id}`} className="kbw-point-title">
            {heading}
          </h4>
          <span className="kbw-point-id">#{String(point.id).padStart(3, "0")}</span>
          {point.relevance ? (
            <span
              className={`kbw-rel ${REL_CLASS[point.relevance] ?? ""}`}
              title={`清单标注的关联度：${point.relevance}`}
            >
              {point.relevance}关联
            </span>
          ) : null}
        </div>

        <p className="kbw-point-meta">
          {point.section ? <span>{point.section}</span> : null}
          {pages.length > 1 ? (
            /* ★ 跨批合并行：一条卡片占两页，图栏的 Tab 顺序跟这个顺序一致。 */
            <span>全 P.{pages.join(" / P.")}</span>
          ) : null}
          {alsoChapters.length > 0 ? (
            <span className="kbw-also">
              亦见 {alsoChapters.map((name) => name.split(" ")[0]).join("、")}
            </span>
          ) : null}
          <span>{point.chapter}</span>
        </p>

        {point.summary && point.summary !== point.name ? (
          <p className="kbw-point-summary">{point.summary}</p>
        ) : null}

        {point.terms.length ? (
          <ul className="kbw-terms" aria-label="关键术语">
            {point.terms.map((term) => (
              <li key={term}>{term}</li>
            ))}
          </ul>
        ) : null}

        {concept ? (
          <div className="kbw-deep">
            <p className="kbw-deep-label">深度解读 · {concept.title}</p>
            <p>{concept.summary}</p>
          </div>
        ) : null}

        {images.length > 0 ? (
          <KbImageTabs images={images} label={`${heading} 原书切片`} />
        ) : null}

        {links ? (
          <div className="kb-item-actions">
            {links.experiments.map((experiment) => (
              <a
                key={experiment.id}
                className="jump-btn exp-btn"
                href={experimentHref(experiment.id)}
                target="_blank"
                rel="noopener noreferrer"
                title={links.reasons.get(experiment.code) ?? experiment.title}
              >
                🚀 运行对应实验 {experiment.code}
              </a>
            ))}
            {links.cases.map((item) => (
              <button
                key={item.id}
                type="button"
                className="jump-btn kb-btn"
                title={links.reasons.get(item.code) ?? item.title}
                onClick={() => onOpenCase(item.id)}
              >
                📁 查看实战案例 {item.code}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
});

/* ---------- 面板 ---------- */

export default function KnowledgePanel({
  onClose,
  initialTarget = null,
  onBackToProblem,
  onOpenCase,
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
  const pendingJump = useRef<PendingJump | null>(null);
  /* 只是用来踢一脚下落 effect 的计数器，见下面 resolver effect 的注释。 */
  const [jumpNonce, setJumpNonce] = useState(0);

  const chapterOptions = useMemo(
    () => knowledgeBase.chapters.filter((item) => !part || item.part === part),
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

  /*
   * 深链解析分两步，因为目标锚点在本帧往往还不存在：
   * `openKnowledgeAt` 在面板已打开时只换 prop、不重新挂载，而锚点要等筛选 state
   * 落进 render 才出现。所以这里只记下落点，滚动交给下面那个 effect。
   *
   * 落点存 ref，但必须另加 jumpNonce 触发：只改 ref 不会引起任何重渲染，
   * 消费它的 effect 就永远不再跑 —— 表现为高亮加上了但页面不滚。
   * 反过来，落点如果做成 state，消费时置 null 会让同一个 effect 立刻重跑，
   * 它上一轮的 cleanup 会把 is-jump-target 和两个定时器一并取消 —— 高亮一闪就没。
   */
  useEffect(() => {
    if (!initialTarget) return;

    /* id 直查；查不到（或本来就只有章节定位）退到章锚点。 */
    const point =
      initialTarget.pointId != null
        ? POINT_BY_ID.get(initialTarget.pointId)
        : undefined;

    setQuery("");

    if (point) {
      /* 锚点渲染在它自己的分组里（★ 行按首个章分组），所以筛选也要跟着收成那一章。 */
      setChapter(point.chapter);
      setPart(point.part);
      pendingJump.current = { kind: "point", selector: `#kb-point-${point.id}` };
    } else {
      const chapterIndex = CHAPTER_INDEX.get(initialTarget.chapter);
      setChapter(initialTarget.chapter);
      setPart(
        knowledgeBase.chapters.find((item) => item.name === initialTarget.chapter)
          ?.part ?? "",
      );
      pendingJump.current = {
        kind: "chapter",
        selector: `#kb-chapter-group-${chapterIndex ?? 0}`,
      };
    }
    setJumpNonce((n) => n + 1);
  }, [initialTarget]);

  /* 把挂起的落点滚出来；没找到就留着，下一轮依赖变化时再来。 */
  useEffect(() => {
    const pending = pendingJump.current;
    if (!pending) return;
    const scroller = resultsRef.current;
    if (!scroller) return;

    const target = scroller.querySelector<HTMLElement>(pending.selector);
    if (!target) return;
    pendingJump.current = null;

    target.classList.add("is-jump-target");

    if (pending.kind === "chapter") {
      /* 章节块比视口高，居中会把头部顶出视野，改成对齐滚动容器顶部。 */
      const offset =
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      scroller.scrollTop = Math.max(0, offset - 2);
    } else {
      /* 一律 auto：平滑滚动靠 rAF 驱动，而用户点 kb:// 之后很可能立刻切走标签页，
         那时 rAF 挂起、smooth 会静默不滚 —— 高亮加上了却看不到，比跳错更难排查。
         带切片的宿主卡比视口还高，居中会把标题顶出视野，那一类对齐到顶部。 */
      target.scrollIntoView({
        block: target.classList.contains("kbw-point--featured") ? "start" : "center",
        behavior: "auto",
      });
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
  }, [groups, jumpNonce]);

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
    /* 搜索框一直挂着（空态只换列表区），不必等一帧再聚焦。 */
    searchRef.current?.focus();
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
              《深度学习》花书 · 全量索引与原书切片
            </p>
          </div>
        </div>

        <div className="panel-stats" aria-label="知识库统计">
          <div>
            <b>{total}</b>
            <span>知识点</span>
          </div>
          <div>
            <b>{PLATE_COUNT}</b>
            <span>带切片</span>
          </div>
          <div>
            <b>{kbImages.length}</b>
            <span>原书切片</span>
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

      <p className="kbw-count" aria-live="polite">
        {matches.length === total
          ? `共 ${total} 个知识点`
          : `匹配到 ${matches.length} / ${total} 个知识点`}
        <span className="kbw-caliber">
          印刷页码 · PDF 页码 = 印刷页码 + {knowledgeBase.pdfOffset}
        </span>
      </p>

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
                className="kbw-group"
                aria-labelledby={`kb-chapter-${index}`}
                tabIndex={-1}
              >
                <header className="kbw-group-head">
                  <p className="kbw-group-part">{item.part}</p>
                  <h3 id={`kb-chapter-${index}`} className="kbw-group-title">
                    {item.name}
                  </h3>
                  <span className="kbw-group-pages">P.{item.pages}</span>
                  <span className="kbw-group-count">{points.length} 条</span>
                </header>
                {item.description ? (
                  <p className="kbw-group-desc">{item.description}</p>
                ) : null}

                <div>
                  {points.map((point) => (
                    <PointCard
                      key={point.id}
                      point={point}
                      pdfOffset={knowledgeBase.pdfOffset}
                      onOpenCase={onOpenCase}
                    />
                  ))}
                </div>
              </section>
            );
          })
        ) : (
          <div className="kbw-empty">
            <p>没有匹配的知识点</p>
            <span>
              {hasFilters
                ? "换个关键词，或清除筛选条件。"
                : "从上方选择章节开始浏览。"}
            </span>
            <button type="button" className="kbw-empty-reset" onClick={resetFilters}>
              清除筛选
            </button>
          </div>
        )}
      </div>

      <footer className="panel-foot">
        <span>依据《深度学习》（花书）中文版整理 · 第 1–7 章为全量清单，第 8–20 章沿用旧版索引</span>
        <span className="flex items-center gap-2">
          <kbd>Esc</kbd> 关闭
        </span>
      </footer>
    </PanelShell>
  );
}
