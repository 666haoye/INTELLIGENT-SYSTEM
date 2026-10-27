import { LAB_EXPERIMENTS, type LabExperiment } from "@/data/experiments";

export type MessageSegment =
  | { type: "text"; text: string }
  | { type: "kb"; page: number; label: string }
  | { type: "exp"; id: string; code: string; label: string };

/**
 * 兼容半角/全角方括号与圆括号，协议名大小写不敏感，允许 "://" 两侧有空格。
 * 标签不跨行，避免把整段文本吞成一个链接。
 */
const LINK_PATTERN =
  /[\[【]([^\]】\n]*)[\]】]\s*[（(]\s*(kb|exp)\s*:\s*\/\s*\/\s*([A-Za-z]?[0-9]+)\s*[)）]/gi;

const EXPERIMENT_BY_CODE = new Map<string, LabExperiment>(
  LAB_EXPERIMENTS.map((item) => [item.code.toLowerCase(), item]),
);

function findExperiment(token: string): LabExperiment | undefined {
  const normalized = token.toLowerCase();
  const digits = normalized.replace(/[^0-9]/g, "");
  return (
    EXPERIMENT_BY_CODE.get(normalized) ??
    (digits ? EXPERIMENT_BY_CODE.get("e" + digits) : undefined)
  );
}

export function parseMessageSegments(raw: string): MessageSegment[] {
  const source = raw ?? "";
  const segments: MessageSegment[] = [];
  let cursor = 0;

  /* 模块级正则带 g，必须复位，否则 lastIndex 会跨调用残留 */
  LINK_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = LINK_PATTERN.exec(source)) !== null) {
    if (match.index > cursor) {
      segments.push({ type: "text", text: source.slice(cursor, match.index) });
    }

    const label = match[1].trim();
    const scheme = match[2].toLowerCase();
    const token = match[3];

    if (scheme === "kb") {
      const page = Number(token.replace(/[^0-9]/g, ""));
      if (Number.isFinite(page) && page > 0) {
        segments.push({ type: "kb", page, label });
      } else {
        segments.push({ type: "text", text: match[0] });
      }
    } else {
      const experiment = findExperiment(token);
      /* 幻觉编号（如 exp://E10）降级为纯文本，不生成 404 链接 */
      if (experiment) {
        segments.push({
          type: "exp",
          id: experiment.id,
          code: experiment.code,
          label,
        });
      } else {
        segments.push({ type: "text", text: label || token });
      }
    }

    cursor = match.index + match[0].length;
    if (match[0].length === 0) LINK_PATTERN.lastIndex += 1; /* 防零宽死循环 */
  }

  if (cursor < source.length) {
    segments.push({ type: "text", text: source.slice(cursor) });
  }

  return segments;
}
