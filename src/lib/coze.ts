import { COZE_PROXY_URL } from "./coze-config";

export type CozeReply = { reply: string; conversationId: string | null };

export type CozeErrorKind =
  | "network"
  | "config"
  | "coze"
  | "timeout"
  | "rate"
  | "empty";

export class CozeError extends Error {
  readonly kind: CozeErrorKind;

  constructor(kind: CozeErrorKind, message: string) {
    super(message);
    this.name = "CozeError";
    this.kind = kind;
  }
}

/* 外层兜底超时。代理内部轮询上限是 25 秒，正常情况先由代理返回明确的超时错误；
   这里的 90 秒只用于兜住「代理进程本身无响应」这种卡死场景。 */
const REQUEST_TIMEOUT_MS = 90_000;

type ProxyPayload = {
  ok?: boolean;
  reply?: string;
  conversationId?: string | null;
  error?: string;
  kind?: CozeErrorKind;
};

export async function sendMessageToCoze(
  userText: string,
  conversationId?: string | null,
): Promise<CozeReply> {
  const text = userText.trim();
  if (!text) throw new CozeError("config", "消息不能为空");

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(COZE_PROXY_URL + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, conversationId: conversationId ?? null }),
      signal: controller.signal,
    });

    const data = (await response.json().catch(() => null)) as
      | ProxyPayload
      | null;

    if (!data?.ok || typeof data.reply !== "string") {
      throw new CozeError(
        data?.kind ?? "coze",
        data?.error ?? "代理返回异常（HTTP " + response.status + "）",
      );
    }

    return { reply: data.reply, conversationId: data.conversationId ?? null };
  } catch (error) {
    if (error instanceof CozeError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new CozeError("timeout", "请求超时（90 秒），请重试");
    }
    throw new CozeError(
      "network",
      "连不上本地 AI 代理，请先在另一个终端运行 npm run proxy",
    );
  } finally {
    window.clearTimeout(timer);
  }
}
