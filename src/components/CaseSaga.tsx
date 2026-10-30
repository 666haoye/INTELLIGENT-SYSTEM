"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { FormalCase } from "@/data/case-library";
import type { CaseSaga, DecisionOption, DecisionRound } from "@/data/case-sagas";
import {
  buildSagaAskPrompt,
  buildSagaDebriefPrompt,
  formatProvenance,
} from "@/lib/case-saga";

/** 交给外层拼「让浩晔老师深入解析」用，不含答案，避免剧透 */
export type SagaSnapshot = {
  roundIndex: number;
  roundTotal: number;
  stage: string;
  brief: string;
  ask: string;
};

type CaseSagaProps = {
  saga: CaseSaga;
  item: FormalCase;
  onAskAI: (text: string, opts?: { auto?: boolean }) => void;
  onSnapshot?: (snapshot: SagaSnapshot) => void;
};

const HOVER_DELAY_MS = 3000;
const ADVANCE_DELAY_MS = 600;

type Focus = { key: string; nonce: number } | null;

type SagaState = {
  total: number;
  round: number;
  picks: Record<number, string>;
  misses: Record<number, number>;
  hintsUsed: Record<string, true>;
  pending: Focus;
  passed: Focus;
  hover: Focus;
  viewing: number | null;
  done: boolean;
};

type SagaAction =
  | { type: "pick"; key: string; correct: boolean; nonce: number }
  | { type: "hover"; key: string; nonce: number }
  | { type: "unhover" }
  | { type: "dismiss" }
  | { type: "advance" }
  | { type: "view"; index: number | null }
  | { type: "reset"; total: number };

function initialSagaState(total: number): SagaState {
  return {
    total,
    round: 0,
    picks: {},
    misses: {},
    hintsUsed: {},
    pending: null,
    passed: null,
    hover: null,
    viewing: null,
    done: false,
  };
}

function sagaReducer(state: SagaState, action: SagaAction): SagaState {
  switch (action.type) {
    case "pick": {
      /* 答对后到切轮之间的 600ms 里，忽略后续点击 */
      if (state.passed || state.done) return state;
      const round = state.round;
      const focus: Focus = { key: action.key, nonce: action.nonce };

      if (action.correct) {
        return {
          ...state,
          picks: { ...state.picks, [round]: action.key },
          passed: focus,
          pending: null,
          hover: null,
        };
      }

      return {
        ...state,
        misses: { ...state.misses, [round]: (state.misses[round] ?? 0) + 1 },
        pending: focus,
        passed: null,
        hover: null,
      };
    }
    case "hover":
      return {
        ...state,
        hover: { key: action.key, nonce: action.nonce },
        hintsUsed: { ...state.hintsUsed, [`${state.round}:${action.key}`]: true },
      };
    case "unhover":
      return state.hover ? { ...state, hover: null } : state;
    case "dismiss":
      return state.pending ? { ...state, pending: null } : state;
    case "advance": {
      if (state.round + 1 >= state.total) {
        return { ...state, done: true, viewing: null, passed: null, hover: null };
      }
      return {
        ...state,
        round: state.round + 1,
        pending: null,
        passed: null,
        hover: null,
        viewing: null,
      };
    }
    case "view":
      return { ...state, viewing: action.index };
    case "reset":
      return initialSagaState(action.total);
    default:
      return state;
  }
}

function correctOptionOf(round: DecisionRound): DecisionOption | undefined {
  return round.options.find((option) => option.correct);
}

function Rail({
  rounds,
  state,
  onView,
}: {
  rounds: DecisionRound[];
  state: SagaState;
  onView: (index: number | null) => void;
}) {
  return (
    <ol className="case-saga-rail" aria-label={`决策进度：共 ${rounds.length} 轮`}>
      {rounds.map((round, index) => {
        const isDone = index < state.round || state.done;
        const isCurrent = !state.done && index === state.round;
        const isViewing = state.viewing === index;
        const className = [
          "case-saga-step",
          isDone ? "is-done" : "",
          isCurrent ? "is-current" : "",
          !isDone && !isCurrent ? "is-locked" : "",
          isViewing ? "is-viewing" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const label = (
          <>
            <span className="case-saga-dot" aria-hidden="true">
              {isDone ? "✓" : round.index}
            </span>
            <span className="case-saga-label">{round.stage}</span>
          </>
        );

        return (
          <li key={round.index} className={className}>
            {isDone ? (
              <button
                type="button"
                className="case-saga-step-btn"
                aria-current={isCurrent ? "step" : undefined}
                aria-pressed={isViewing}
                onClick={() => onView(isViewing ? null : index)}
                title={`回看第 ${round.index} 轮（只读）`}
              >
                {label}
              </button>
            ) : (
              <span
                className="case-saga-step-btn is-frozen"
                aria-current={isCurrent ? "step" : undefined}
                aria-disabled={!isCurrent}
              >
                {label}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ConsequenceCard({
  option,
  cardRef,
  onAsk,
  onDismiss,
}: {
  option: DecisionOption;
  cardRef: RefObject<HTMLDivElement | null>;
  onAsk: () => void;
  onDismiss: () => void;
}) {
  if (option.correct) return null;
  const consequence = option.consequence;

  return (
    <div
      className="case-consequence"
      role="region"
      aria-label="这个选择的工程后果"
      ref={cardRef}
    >
      <p className="cc-head" role="status">{consequence.head}</p>
      <p className="cc-timeline">⏱ {consequence.timeline}</p>

      <p className="cc-label">现场症状</p>
      <ul className="cc-symptoms">
        {consequence.symptoms.map((symptom) => (
          <li key={symptom}>{symptom}</li>
        ))}
      </ul>

      <p className="cc-label">根因</p>
      <p className="cc-root">{consequence.rootCause}</p>

      <p className="cc-label">代价</p>
      <p className="cc-cost">{consequence.cost}</p>

      <div className="cc-provenance">
        {consequence.provenance.map((item) => {
          const badge = formatProvenance(item);
          return (
            <span key={badge.label} className={`cc-badge is-${badge.tone}`}>
              {badge.label}
            </span>
          );
        })}
      </div>

      <div className="cc-actions">
        <button type="button" className="jump-btn case-ai-btn" onClick={onAsk}>
          🤖 呼叫浩晔老师分析原因
        </button>
        <button type="button" className="jump-btn cc-ghost" onClick={onDismiss}>
          我再想想
        </button>
      </div>
    </div>
  );
}

export default function CaseSaga({
  saga,
  item,
  onAskAI,
  onSnapshot,
}: CaseSagaProps) {
  const [state, dispatch] = useReducer(
    sagaReducer,
    saga.rounds.length,
    initialSagaState,
  );
  const [coarsePointer, setCoarsePointer] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const timers = useRef<Map<string, number>>(new Map());
  const nonceRef = useRef(0);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const nextNonce = useCallback(() => {
    nonceRef.current += 1;
    return nonceRef.current;
  }, []);

  const clearAllTimers = useCallback(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
  }, []);

  useEffect(() => clearAllTimers, [clearAllTimers]);

  useEffect(() => {
    clearAllTimers();
    dispatch({ type: "unhover" });
  }, [state.round, state.done, clearAllTimers]);

  useEffect(() => {
    setCoarsePointer(window.matchMedia("(pointer: coarse)").matches);
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = (event: MediaQueryListEvent) =>
      setReducedMotion(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const meta = useMemo(
    () => ({
      code: item.code,
      title: item.title,
      chapter: item.chapter,
      page: item.page,
    }),
    [item.chapter, item.code, item.page, item.title],
  );

  const playRound = saga.rounds[state.round];
  const viewRound =
    state.viewing === null ? null : saga.rounds[state.viewing] ?? null;

  useEffect(() => {
    if (!playRound) return;
    onSnapshot?.({
      roundIndex: playRound.index,
      roundTotal: saga.rounds.length,
      stage: playRound.stage,
      brief: playRound.brief,
      ask: playRound.ask,
    });
  }, [onSnapshot, playRound, saga.rounds.length]);

  /* 只清计时器，不立刻收起提示：指针移到提示框上阅读时不该消失。
     提示会在选择、切轮、重开时统一清掉。 */
  const cancelHoverTimers = useCallback(() => {
    timers.current.forEach((timer, key) => {
      if (key.startsWith("hover:")) {
        window.clearTimeout(timer);
        timers.current.delete(key);
      }
    });
  }, []);

  const startHover = useCallback(
    (key: string) => {
      if (state.passed || state.done) return;
      const id = `hover:${state.round}:${key}`;
      if (timers.current.has(id)) return;
      const timer = window.setTimeout(() => {
        timers.current.delete(id);
        dispatch({ type: "hover", key, nonce: nextNonce() });
      }, HOVER_DELAY_MS);
      timers.current.set(id, timer);
    },
    [nextNonce, state.done, state.passed, state.round],
  );

  const showHintNow = useCallback(
    (key: string) => {
      clearAllTimers();
      dispatch({ type: "hover", key, nonce: nextNonce() });
    },
    [clearAllTimers, nextNonce],
  );

  const pick = useCallback(
    (option: DecisionOption) => {
      clearAllTimers();
      dispatch({
        type: "pick",
        key: option.key,
        correct: option.correct,
        nonce: nextNonce(),
      });
      if (!option.correct) return;
      const timer = window.setTimeout(() => {
        timers.current.delete("advance");
        dispatch({ type: "advance" });
      }, ADVANCE_DELAY_MS);
      timers.current.set("advance", timer);
    },
    [clearAllTimers, nextNonce],
  );

  const reset = useCallback(() => {
    clearAllTimers();
    dispatch({ type: "reset", total: saga.rounds.length });
  }, [clearAllTimers, saga.rounds.length]);

  /* 后果卡片出现后滚到可视区，别让它落在折叠线以下 */
  useEffect(() => {
    if (!state.pending) return;
    const card = cardRef.current;
    if (!card) return;
    card.scrollIntoView({
      block: "nearest",
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }, [state.pending, reducedMotion]);

  const totalMisses = Object.values(state.misses).reduce(
    (sum, value) => sum + value,
    0,
  );
  const hintsUsed = Object.keys(state.hintsUsed).length;

  const trajectory = saga.rounds
    .map((round, index) => {
      const pickKey = state.picks[index];
      const misses = state.misses[index] ?? 0;
      if (!pickKey) return `R${round.index} 未完成`;
      if (misses === 0) return `R${round.index} ✓ 一次过`;
      return `R${round.index} ✗${misses}次→${pickKey}`;
    })
    .join(" · ");

  const renderRound = (round: DecisionRound, review: boolean) => {
    const answeredKey = state.picks[round.index - 1];
    const misses = state.misses[round.index - 1] ?? 0;
    const pendingOption =
      !review && state.pending
        ? round.options.find((option) => option.key === state.pending?.key) ?? null
        : null;
    const correctOption = correctOptionOf(round);

    return (
      <div className="case-saga-body" key={`round-${round.index}`}>
        {round.index === 1 ? (
          <p className="case-saga-opening">{saga.opening}</p>
        ) : null}

        <p className="case-saga-brief">{round.brief}</p>
        <p className="case-saga-ask">{round.ask}</p>

        <div className="case-saga-choices">
          {round.options.map((option) => {
            const isPicked = state.passed?.key === option.key;
            const isPending = state.pending?.key === option.key;
            const isAnswer = review && option.correct;
            const isWrong = isPending || (review && answeredKey === option.key && !option.correct);
            const stateClass = isAnswer || isPicked
              ? " is-correct"
              : isWrong
                ? " is-wrong"
                : state.passed || review
                  ? " is-locked"
                  : "";

            return (
              <div className="case-saga-choice" key={option.key}>
                <button
                  type="button"
                  className={`case-option${stateClass}`}
                  aria-disabled={review || Boolean(state.passed)}
                  aria-pressed={isPicked || isPending}
                  onClick={() => {
                    if (review || state.passed) return;
                    pick(option);
                  }}
                  onPointerEnter={(event) => {
                    if (review || coarsePointer || event.pointerType === "touch") return;
                    startHover(option.key);
                  }}
                  onPointerLeave={cancelHoverTimers}
                  onPointerCancel={cancelHoverTimers}
                  onFocus={() => {
                    if (review || coarsePointer) return;
                    startHover(option.key);
                  }}
                  onBlur={cancelHoverTimers}
                >
                  <span className="case-option-key" aria-hidden="true">
                    {option.key}
                  </span>
                  <span className="case-option-text">{option.text}</span>
                  {isAnswer || isPicked ? (
                    <span className="case-option-mark" aria-hidden="true">
                      ✓
                    </span>
                  ) : null}
                </button>

                {coarsePointer && !review && !state.passed ? (
                  <button
                    type="button"
                    className="case-hint-toggle"
                    onClick={() => showHintNow(option.key)}
                  >
                    💡 看提示
                  </button>
                ) : null}

                {!review && state.hover?.key === option.key ? (
                  <div className="case-hint" role="note">
                    <p className="case-hint-name">浩晔老师</p>
                    <p className="case-hint-text">
                      {misses >= 2 && option.aiHint.strongText
                        ? option.aiHint.strongText
                        : option.aiHint.text}
                    </p>
                    {option.aiHint.page ? (
                      <p className="case-hint-page">线索：教材 P.{option.aiHint.page}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {!review && state.passed && correctOption?.correct ? (
          <p className="case-saga-pass" role="status">
            {correctOption.feedback}
          </p>
        ) : null}

        {review ? (
          <p className="case-saga-review-note" role="note">
            回看模式 · 你当时在这一轮踩坑 {misses} 次，决策不可更改。
          </p>
        ) : null}

        {pendingOption ? (
          <ConsequenceCard
            option={pendingOption}
            cardRef={cardRef}
            onAsk={() => {
              if (!correctOption) return;
              onAskAI(
                buildSagaAskPrompt({
                  meta,
                  round,
                  roundTotal: saga.rounds.length,
                  picked: pendingOption,
                  correct: correctOption,
                  misses,
                }),
                { auto: true },
              );
            }}
            onDismiss={() => dispatch({ type: "dismiss" })}
          />
        ) : null}
      </div>
    );
  };

  const debrief = (
    <div className="case-saga-body case-saga-debrief" key="debrief">
      <p className="case-saga-opening">{saga.debrief.summary}</p>

      <div className="case-reveal">
        {/* 01 / 问题 已经渲染在 CaseDetail 顶部，这里只补 02–04，避免重复 */}
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

      <div className="case-saga-trajectory">
        <p className="cc-label">你的决策轨迹</p>
        <p>{trajectory}</p>
        <p className="case-saga-score">
          踩坑 {totalMisses} 次 · 用过 {hintsUsed} 次提示
        </p>
      </div>

      <div className="case-saga-recap">
        <p className="cc-label">四轮回扣</p>
        <ul>
          {saga.rounds.map((round, index) => {
            const correct = correctOptionOf(round);
            const misses = state.misses[index] ?? 0;
            return (
              <li key={round.index}>
                <span>R{round.index} {round.stage}</span>
                <span>{correct ? `${correct.key}. ${correct.text}` : "—"}</span>
                {misses > 0 ? (
                  <span className="case-saga-miss">这一轮踩坑 {misses} 次</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      <p className="case-saga-cta">{saga.debrief.textbookCta}</p>

      <div className="cc-actions">
        <button type="button" className="jump-btn cc-ghost" onClick={reset}>
          ↻ 再走一遍
        </button>
        <button
          type="button"
          className="jump-btn case-ai-btn"
          onClick={() =>
            onAskAI(
              buildSagaDebriefPrompt({
                meta,
                trajectory,
                misses: totalMisses,
                hints: hintsUsed,
                summary: saga.debrief.summary,
              }),
            )
          }
        >
          🤖 让浩晔老师总复盘
        </button>
      </div>
    </div>
  );

  const activeRound = viewRound ?? playRound;
  const isReview = viewRound !== null;

  return (
    <section className="case-saga" aria-label="多轮决策博弈">
      <div className="case-saga-top">
        <div className="min-w-0">
          <p className="case-saga-kicker">
            DECISION SAGA · {saga.rounds.length} ROUNDS
          </p>
          <p className="case-saga-progress" aria-live="polite">
            {isReview
              ? `回看第 ${activeRound.index} / ${state.total} 轮`
              : state.done
                ? "博弈完成 · 已解锁案例复盘"
                : `决策博弈 · 第 ${activeRound.index} / ${state.total} 轮 · 已踩坑 ${totalMisses} 次`}
          </p>
        </div>
        <button type="button" className="case-saga-reset" onClick={reset}>
          ↻ 重开本案例
        </button>
      </div>

      <Rail
        rounds={saga.rounds}
        state={state}
        onView={(index) => dispatch({ type: "view", index })}
      />

      {state.done && !isReview
        ? debrief
        : activeRound
          ? renderRound(activeRound, isReview)
          : null}
    </section>
  );
}
