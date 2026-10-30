"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { experimentHref } from "@/data/experiments";
import { CozeError, sendMessageToCoze } from "@/lib/coze";
import { resolvePageToKnowledgeTarget } from "@/lib/knowledge-links";
import { parseMessageSegments, type MessageSegment } from "@/lib/protocol";
import type { KnowledgeTarget } from "@/lib/question-search";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  segments: MessageSegment[];
  pending?: boolean;
  error?: string;
};

type AssistantDockProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJumpToKnowledge: (target: KnowledgeTarget) => void;
  /** 外部预填输入框：nonce 变化即重新填入。
   *  auto 缺省（false）= 只填不发，发送决定权留给用户；
   *  auto = true = 填入后自动发送一次，同一个 nonce 只发一次（案例库错误复盘用）。 */
  prefill?: { text: string; nonce: number; auto?: boolean } | null;
};

const CONVERSATION_KEY = "zj.ai.conversation";
const THINKING_TEXT = "浩晔老师正在思考中...";
const HINT_TIMEOUT_MS = 3000;
/* 等 Dock 挂载、输入框 ref 就绪后再发，避免文本还没落盘就调用 */
const AUTO_SEND_DELAY_MS = 120;
const EMPTY_HINT = "问我任何深度学习问题，我会把对应的教材页码和配套实验一起给你。";

let sequence = 0;
function nextId(): string {
  sequence += 1;
  return "ai-msg-" + sequence;
}

function SegmentView({
  segment,
  onJumpKb,
}: {
  segment: MessageSegment;
  onJumpKb: (page: number) => void;
}) {
  if (segment.type === "kb") {
    return (
      <button
        type="button"
        className="jump-btn kb-btn"
        title={segment.label || undefined}
        onClick={() => onJumpKb(segment.page)}
      >
        查看教材 P.{segment.page}
      </button>
    );
  }

  if (segment.type === "exp") {
    return (
      <a
        className="jump-btn exp-btn"
        href={experimentHref(segment.id)}
        target="_blank"
        rel="noopener noreferrer"
        title={segment.label || undefined}
      >
        运行实验 {segment.code}
      </a>
    );
  }

  return <>{segment.text}</>;
}

export default function AssistantDock({
  open,
  onOpenChange,
  onJumpToKnowledge,
  prefill = null,
}: AssistantDockProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");
  /* 只在 useEffect 里读 sessionStorage，避免 SSR / 水合不一致 */
  const [conversationId, setConversationId] = useState<string | null>(null);

  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /* 自动发送去重：同一个 nonce 只处理一次；发送后也不再回填输入框 */
  const lastAutoNonce = useRef<number | null>(null);

  useEffect(() => {
    try {
      setConversationId(sessionStorage.getItem(CONVERSATION_KEY));
    } catch {
      /* file:// 或隐私模式下可能不可用，退化为单轮会话 */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [open]);

  /* 外部预填：auto 为假时只填不发，把发送决定权留给用户；
     auto 为真时不抢焦点（移动端会弹键盘盖住对话），由下面的效果负责发送。 */
  useEffect(() => {
    if (!prefill) return;
    /* 自动发送已经处理过这个 nonce，就不再把它回填到输入框 */
    if (prefill.auto && lastAutoNonce.current === prefill.nonce) return;
    setDraft(prefill.text);
    if (!open || prefill.auto) return;
    const timer = window.setTimeout(() => {
      const box = inputRef.current;
      if (!box) return;
      box.focus({ preventScroll: true });
      box.setSelectionRange(box.value.length, box.value.length);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [prefill, open]);

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    log.scrollTop = log.scrollHeight;
  }, [messages, open, hint]);

  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(""), HINT_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [hint]);

  /* Esc 分层：必须用捕获阶段 + stopPropagation。
     PanelShell.tsx:66 在 document 上挂了冒泡阶段的 Esc 监听，
     否则面板与 Dock 同时打开时，一次 Esc 会把两层一起关掉。 */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      onOpenChange(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onOpenChange]);

  const rememberConversation = useCallback((id: string | null) => {
    if (!id) return;
    setConversationId(id);
    try {
      sessionStorage.setItem(CONVERSATION_KEY, id);
    } catch {
      /* 存不住就退化为单轮 */
    }
  }, []);

  /* 同步单飞锁：busy 是异步 state，同一轮事件里连点仍可能读到旧的 false，
     所以在函数入口用 ref 立刻占位，保证 /chat 不会被并发打出多次。 */
  const sendingRef = useRef(false);

  const send = useCallback(async (override?: string) => {
    /* 自动发送时 draft 还没落盘，所以允许直接传入文本 */
    const text = (override ?? draft).trim();
    if (!text || busy || sendingRef.current) return;

    sendingRef.current = true;
    setDraft("");
    setHint("");
    setBusy(true);

    const pendingId = nextId();
    setMessages((previous) => [
      ...previous,
      { id: nextId(), role: "user", segments: [{ type: "text", text }] },
      {
        id: pendingId,
        role: "assistant",
        segments: [{ type: "text", text: THINKING_TEXT }],
        pending: true,
      },
    ]);

    try {
      const result = await sendMessageToCoze(text, conversationId);
      rememberConversation(result.conversationId);
      const segments = parseMessageSegments(result.reply);
      setMessages((previous) =>
        previous.map<ChatMessage>((message) =>
          message.id === pendingId
            ? { id: message.id, role: "assistant", segments }
            : message,
        ),
      );
    } catch (error) {
      const message =
        error instanceof CozeError ? error.message : "AI 请求失败，请重试";
      setMessages((previous) =>
        previous.map<ChatMessage>((item) =>
          item.id === pendingId
            ? {
                id: item.id,
                role: "assistant",
                segments: [{ type: "text", text: message }],
                error: message,
              }
            : item,
        ),
      );
    } finally {
      sendingRef.current = false;
      setBusy(false);
    }
  }, [busy, conversationId, draft, rememberConversation]);

  /* 自动发送只认 nonce，不认 prefill 对象引用（父组件重渲染不会重复发）。
     nonce 在真正发出前才写入：若 120ms 内用户关掉 Dock，定时器被清掉，
     重开时同一 nonce 仍会补发，不会出现「点了没反应」。 */
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });

  const autoNonce = prefill?.auto ? prefill.nonce : null;
  const autoText = prefill?.auto ? prefill.text : null;

  useEffect(() => {
    if (!open || autoNonce === null || autoText === null) return;
    if (lastAutoNonce.current === autoNonce) return;

    if (busy) {
      lastAutoNonce.current = autoNonce;
      setHint("上一条还在回答中，问题已填入输入框，点发送即可");
      return;
    }

    const timer = window.setTimeout(() => {
      if (lastAutoNonce.current === autoNonce) return;
      lastAutoNonce.current = autoNonce;
      void sendRef.current(autoText);
    }, AUTO_SEND_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [autoNonce, autoText, busy, open]);

  const reset = useCallback(() => {
    setMessages([]);
    setHint("");
    setConversationId(null);
    try {
      sessionStorage.removeItem(CONVERSATION_KEY);
    } catch {
      /* 忽略 */
    }
  }, []);

  const jumpToPage = useCallback(
    (page: number) => {
      const target = resolvePageToKnowledgeTarget(page);
      if (!target) {
        setHint("未找到教材 P." + page + " 对应的知识点");
        return;
      }
      setHint("");
      onJumpToKnowledge(target);
    },
    [onJumpToKnowledge],
  );

  return (
    <>
      {open ? null : (
        <button
          type="button"
          className="ai-dock__launcher"
          onClick={() => onOpenChange(true)}
          aria-haspopup="dialog"
          aria-label="打开 AI 助手"
          title="AI 助手"
        >
          <span className="ai-dock__launcher-icon" aria-hidden="true" />
          <span>AI 助手</span>
        </button>
      )}

      {open ? (
        <section
          className="ai-dock"
          role="dialog"
          aria-label="AI 助手"
          aria-modal="false"
        >
          <header className="ai-dock__head">
            <span className="ai-dock__title">
              <span className="ai-dock__dot" aria-hidden="true" />
              浩晔老师
            </span>
            <span className="ai-dock__tools">
              <button
                type="button"
                className="ai-dock__btn"
                onClick={reset}
                title="清空当前记录"
              >
                清空
              </button>
              <button
                type="button"
                className="ai-dock__btn"
                onClick={() => onOpenChange(false)}
                aria-label="关闭 AI 助手"
                title="关闭（Esc）"
              >
                ✕
              </button>
            </span>
          </header>

          <div
            className="ai-dock__log"
            ref={logRef}
            aria-live="polite"
            aria-relevant="additions text"
          >
            {messages.length === 0 ? (
              <p className="ai-dock__empty">{EMPTY_HINT}</p>
            ) : null}

            {messages.map((message) => (
              <div
                key={message.id}
                className={[
                  "ai-msg",
                  message.role === "user" ? "ai-msg--user" : "ai-msg--bot",
                  message.pending ? "is-pending" : "",
                  message.error ? "is-error" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className="ai-bubble">
                  {message.segments.map((segment, index) => (
                    <SegmentView
                      key={index}
                      segment={segment}
                      onJumpKb={jumpToPage}
                    />
                  ))}
                </div>
              </div>
            ))}

            {hint ? (
              <p className="ai-dock__hint" role="status">
                {hint}
              </p>
            ) : null}
          </div>

          <form
            className="ai-dock__composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              className="ai-dock__input"
              ref={inputRef}
              rows={1}
              value={draft}
              placeholder="输入问题，Enter 发送 / Shift+Enter 换行"
              aria-label="给 AI 助手的消息"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                /* isComposing：中文输入法按 Enter 选词时不应发送 */
                if (
                  event.key !== "Enter" ||
                  event.shiftKey ||
                  event.nativeEvent.isComposing
                ) {
                  return;
                }
                event.preventDefault();
                void send();
              }}
            />
            <button
              type="submit"
              className="ai-dock__send"
              disabled={busy || draft.trim().length === 0}
            >
              发送
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
