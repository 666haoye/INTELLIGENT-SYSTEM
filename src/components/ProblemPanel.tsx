"use client";

import { useRef, useState, type FormEvent } from "react";
import { questionIndex, type StarterQuestion } from "@/data/question-index";
import {
  searchKnowledge,
  type KnowledgeTarget,
  type SearchHit,
  type SearchResponse,
} from "@/lib/question-search";
import PanelShell from "./PanelShell";

type ProblemPanelProps = {
  initialQuery?: string;
  onJumpToKnowledge: (target: KnowledgeTarget, query: string) => void;
  onClose: () => void;
};

const KIND_LABELS: Record<SearchHit["kind"], string> = {
  point: "知识点",
  chapter: "章节笔记",
  formula: "附录公式",
};

function QuestionEmblem() {
  return (
    <svg viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="17" stroke="currentColor" strokeOpacity=".18" />
      <circle
        cx="24"
        cy="24"
        r="11"
        stroke="currentColor"
        strokeOpacity=".38"
        strokeDasharray="1 4"
      />
      <path
        d="M19.5 19.2c0-3 2.1-5.1 5.1-5.1 3.1 0 5.2 2 5.2 5 0 3.8-5.2 3.5-5.2 8"
        stroke="currentColor"
        strokeOpacity=".85"
        strokeLinecap="round"
      />
      <circle cx="24.5" cy="32.8" r="1.6" fill="currentColor" />
      <circle cx="41" cy="24" r="1.5" fill="currentColor" />
    </svg>
  );
}

function citation(hit: SearchHit): string {
  if (hit.kind === "formula") {
    return `附录 A · 印刷页 P.${hit.page ?? "—"} · ${hit.chapter}`;
  }
  if (hit.kind === "chapter") {
    return `${hit.chapter} · 印刷页 P.${hit.chapterPages ?? "—"} · ${hit.section}`;
  }
  return `${hit.chapter} · ${hit.section} · 印刷页 P.${hit.page ?? "—"}`;
}

function AnswerCard({
  hit,
  intentLabel,
  onJump,
}: {
  hit: SearchHit;
  intentLabel: string;
  onJump: () => void;
}) {
  const terms = (hit.matchedTerms.length ? hit.matchedTerms : hit.terms).slice(0, 6);

  return (
    <article className="problem-answer">
      <div className="problem-answer-eyebrow">
        <span>{KIND_LABELS[hit.kind]}</span>
        <span className="problem-answer-divider" aria-hidden="true" />
        <span>{intentLabel}</span>
        <span className="problem-answer-source">{citation(hit)}</span>
      </div>

      <h3>{hit.title}</h3>
      <p>{hit.text}</p>

      {terms.length ? (
        <ul className="problem-answer-terms" aria-label="命中关键词">
          {terms.map((term) => (
            <li key={term}>{term}</li>
          ))}
        </ul>
      ) : null}

      <div className="problem-answer-footer">
        <p>摘录自知识库原文，可定位核对章节与页码。</p>
        <button type="button" className="problem-jump" onClick={onJump}>
          在知识库中定位
          <span aria-hidden="true">↗</span>
        </button>
      </div>
    </article>
  );
}

export default function ProblemPanel({
  initialQuery = "",
  onJumpToKnowledge,
  onClose,
}: ProblemPanelProps) {
  const initial = initialQuery.trim();
  const [query, setQuery] = useState(initial);
  const [result, setResult] = useState<SearchResponse | null>(() =>
    initial ? searchKnowledge(initial) : null,
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const runSearch = (value: string) => {
    const next = value.trim();
    setQuery(next);
    setResult(next ? searchKnowledge(next) : null);
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runSearch(query);
  };

  const handleSeed = (seed: StarterQuestion) => {
    setQuery(seed.text);
    setResult(searchKnowledge(seed.text));
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  };

  const handleJump = (hit: SearchHit) => {
    const activeQuery = result?.query ?? query.trim();
    onJumpToKnowledge(
      { ...hit.target, query: activeQuery },
      activeQuery,
    );
  };

  const clear = () => {
    setQuery("");
    setResult(null);
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  };

  const answer = result?.answer ?? null;
  const related = result?.hits.slice(1, 5) ?? [];
  const seeds = questionIndex.starterQuestions;
  const noMatch = Boolean(result?.noMatch);

  return (
    <PanelShell
      labelledBy="problem-title"
      describedBy="problem-intro"
      onClose={onClose}
      className="panel--problem"
    >
      <header className="flex flex-wrap items-start gap-6 border-b border-cyan-100/10 px-6 pb-5 pt-6 sm:px-8">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span className="panel-emblem" aria-hidden="true">
            <QuestionEmblem />
          </span>
          <div className="min-w-0">
            <p className="panel-kicker">NEURAL NODE 02 / ASK</p>
            <h2 id="problem-title" className="panel-title">
              问题导向
            </h2>
            <p id="problem-intro" className="panel-subtitle">
              从一个问题出发，找到知识，再回到原文
            </p>
          </div>
        </div>

        <div className="panel-stats" aria-label="问题导向检索范围">
          <div>
            <b>{questionIndex.stats.points}</b>
            <span>知识点</span>
          </div>
          <div>
            <b>{questionIndex.stats.chapters}</b>
            <span>章</span>
          </div>
          <div>
            <b>{questionIndex.stats.terms}</b>
            <span>术语</span>
          </div>
        </div>

        <button
          type="button"
          className="panel-close"
          aria-label="关闭问题导向"
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M7 7 17 17M17 7 7 17" />
          </svg>
        </button>
      </header>

      <div className="problem-search-zone">
        <form className="problem-search" onSubmit={handleSubmit}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="10.8" cy="10.8" r="6.2" />
            <path d="M15.4 15.4 20 20" />
          </svg>
          <input
            id="problem-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                runSearch(event.currentTarget.value);
              }
            }}
            placeholder="输入你的问题，例如：Dropout 为什么能防止过拟合？"
            autoComplete="off"
            spellCheck={false}
            data-panel-autofocus
            aria-label="输入问题检索知识库"
          />
          {query ? (
            <button
              type="button"
              className="problem-clear"
              aria-label="清空问题和结果"
              onClick={clear}
            >
              ×
            </button>
          ) : null}
          <button type="submit" className="problem-submit" disabled={!query.trim()}>
            检索
            <span aria-hidden="true">↵</span>
          </button>
        </form>
        <div className="problem-search-meta">
          <span>本地知识库检索 · 回答带原文页码 · 无外部请求</span>
          {result ? (
            <button type="button" className="problem-reset" onClick={clear}>
              重新提问
            </button>
          ) : (
            <span>或直接输入自己的问题</span>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="problem-scroll">
        {!result ? (
          <div className="problem-intro">
            <div className="problem-intro-copy">
              <p className="problem-intro-kicker">ASK THE LIBRARY</p>
              <p>
                不用先记住章节。直接描述你的问题，系统会在 169 个知识点、20
                篇章节笔记和附录公式中寻找最相关的内容，并把答案带回知识库对应位置。
              </p>
            </div>

            <div className="problem-section-title">
              <span>可以这样问</span>
              <span>{seeds.length} 个问题种子</span>
            </div>
            <div className="problem-seed-grid">
              {seeds.map((seed) => (
                <button
                  key={seed.id}
                  type="button"
                  className="problem-seed"
                  onClick={() => handleSeed(seed)}
                >
                  <span className="problem-seed-category">{seed.category}</span>
                  <span className="problem-seed-text">{seed.text}</span>
                  <span className="problem-seed-arrow" aria-hidden="true">
                    ↗
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : noMatch ? (
          <div className="problem-empty">
            <span className="problem-empty-orb" aria-hidden="true" />
            <p>知识库里暂时没有足够匹配的内容</p>
            <span>试试更短的关键词，或从下面的问题开始。</span>
            <div className="problem-followups problem-followups--empty">
              {(result.suggestions.length
                ? result.suggestions
                : seeds.slice(0, 4)
              ).map((seed) => (
                <button
                  key={seed.id}
                  type="button"
                  className="problem-followup"
                  onClick={() => handleSeed(seed)}
                >
                  {seed.text}
                </button>
              ))}
            </div>
          </div>
        ) : answer ? (
          <div className="problem-results">
            <div className="problem-section-title">
              <span>
                {result.hits.length} 个知识库命中
                {result.intentLabel ? ` · ${result.intentLabel}` : ""}
              </span>
              <span>按相关度排序</span>
            </div>

            <AnswerCard
              hit={answer}
              intentLabel={result.intentLabel}
              onJump={() => handleJump(answer)}
            />

            {related.length ? (
              <section className="problem-related" aria-label="相关知识">
                <div className="problem-section-title">
                  <span>相关知识</span>
                  <span>继续定位</span>
                </div>
                <div className="problem-related-list">
                  {related.map((hit) => (
                    <button
                      key={hit.id}
                      type="button"
                      className="problem-related-item"
                      onClick={() => handleJump(hit)}
                    >
                      <span className="problem-related-kind">
                        {KIND_LABELS[hit.kind]}
                      </span>
                      <span className="problem-related-title">{hit.title}</span>
                      <span className="problem-related-source">
                        {citation(hit)}
                      </span>
                      <span className="problem-related-text">{hit.text}</span>
                      <span className="problem-related-arrow" aria-hidden="true">
                        ↗
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {result.suggestions.length ? (
              <section className="problem-followups-wrap" aria-label="继续追问">
                <div className="problem-section-title">
                  <span>换一种问法</span>
                </div>
                <div className="problem-followups">
                  {result.suggestions.map((seed) => (
                    <button
                      key={seed.id}
                      type="button"
                      className="problem-followup"
                      onClick={() => handleSeed(seed)}
                    >
                      {seed.text}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>

      <footer className="panel-foot">
        <span>回答为知识库原文摘录 · 未调用外部模型</span>
        <span className="flex items-center gap-2">
          <kbd>Esc</kbd> 关闭
        </span>
      </footer>
    </PanelShell>
  );
}
