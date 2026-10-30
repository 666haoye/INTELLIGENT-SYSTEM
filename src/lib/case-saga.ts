/* 案例库多轮博弈的 prompt 组装（纯函数，无网络、无 UI）。
 *
 * 这里只负责把「案例 + 轮次 + 用户选择 + 后果」拼成一段给浩晔老师的话。
 * 真正的发送仍然走 AssistantDock 里既有的发送封装，前端不新增任何扣子
 * 请求代码，也不碰 Token。
 */

import type {
  DecisionOption,
  DecisionRound,
  EngineeringConsequence,
  Provenance,
} from "@/data/case-sagas";

export type SagaCaseMeta = {
  code: string;
  title: string;
  chapter: string;
  page: number | null;
};

/** 轮次里 prompt 真正用到的字段，避免为了拼一句话去构造完整选项数组 */
export type SagaRoundBrief = Pick<
  DecisionRound,
  "index" | "stage" | "brief" | "ask"
>;

export type ProvenanceBadge = {
  tone: "textbook" | "inference";
  label: string;
};

/** 把一条出处渲染成徽章文案；UI 与 prompt 共用同一套措辞 */
export function formatProvenance(provenance: Provenance): ProvenanceBadge {
  if (provenance.kind === "textbook") {
    return { tone: "textbook", label: "📘 教材依据 · " + provenance.ref };
  }
  return { tone: "inference", label: "🧪 工程推演 · " + provenance.basis };
}

function caseHeader(meta: SagaCaseMeta): string {
  const page = meta.page === null ? "页码未单列" : "教材 P." + meta.page;
  return `${meta.code} · ${meta.chapter} · ${page}`;
}

function consequenceLines(
  consequence: EngineeringConsequence,
  withProvenance: boolean,
): string[] {
  const lines = [
    "· 结论：" + consequence.head,
    "· 暴露时间：" + consequence.timeline,
    "· 现场症状：" + consequence.symptoms.join("；"),
    "· 根本原因：" + consequence.rootCause,
    "· 代价：" + consequence.cost,
  ];
  if (withProvenance) {
    lines.push(
      "· 出处：" +
        consequence.provenance.map((item) => formatProvenance(item).label).join(" / "),
    );
  }
  return lines;
}

/** 选错后点「呼叫浩晔老师分析原因」：完整错误上下文 + 答案 + 后果 */
export function buildSagaAskPrompt(args: {
  meta: SagaCaseMeta;
  round: DecisionRound;
  roundTotal: number;
  picked: DecisionOption;
  correct: DecisionOption;
  misses: number;
}): string {
  const { meta, round, roundTotal, picked, correct, misses } = args;
  const consequence =
    picked.correct === false ? picked.consequence : null;

  const blocks = [
    `浩晔老师，我在《${meta.title}》（${caseHeader(meta)}）的决策博弈第 ${round.index} / ${roundTotal} 轮「${round.stage}」选错了。`,
    "",
    "【当时的情境】" + round.brief,
    "【本轮的问题】" + round.ask,
    `【我选的】${picked.key}. ${picked.text}`,
    `【教材记载的正确方向】${correct.key}. ${correct.text}`,
  ];

  if (consequence) {
    blocks.push(
      "",
      "我这个选择往下推演，会遇到的后果是：",
      ...consequenceLines(consequence, true),
    );
  }

  blocks.push(
    "",
    `我已经在这一轮错了 ${misses} 次。请帮我：`,
    "1. 讲透这条路线为什么走不通，重点落在我上面给出的教材页码那一节；",
    "2. 指出我这个选择里「看起来合理、实际致命」的那一步是什么；",
    "3. 给一个 30 分钟内能动手验证的小实验，让我自己看到问题。",
    "",
    "如果上面标注了「工程推演」，请把它当作推演来讨论，不要当成当年的史实复述。",
  );

  return blocks.join("\n");
}

/** 面板顶部「让浩晔老师深入解析」：不剧透答案，只帮用户理清当前轮的权衡 */
export function buildSagaRoundPrompt(args: {
  meta: SagaCaseMeta;
  round: SagaRoundBrief;
  roundTotal: number;
}): string {
  const { meta, round, roundTotal } = args;
  return [
    `浩晔老师，我正在做《${meta.title}》（${caseHeader(meta)}）的多轮决策博弈，现在卡在第 ${round.index} / ${roundTotal} 轮「${round.stage}」。`,
    "",
    "【这一轮的情境】" + round.brief,
    "【我要决定的事】" + round.ask,
    "",
    "我还没做选择，请先别告诉我正确选项。帮我梳理三件事：",
    "1. 这个决策真正要权衡的技术变量是什么；",
    "2. 每个方向在教材里对应哪一节，请给印刷页码；",
    "3. 如果我想用一个小实验自己验证，最短的路径是什么。",
  ].join("\n");
}

/** 通关后的总复盘：带上决策轨迹，让老师针对踩坑点讲 */
export function buildSagaDebriefPrompt(args: {
  meta: SagaCaseMeta;
  trajectory: string;
  misses: number;
  hints: number;
  summary: string;
}): string {
  const { meta, trajectory, misses, hints, summary } = args;
  return [
    `浩晔老师，《${meta.title}》（${caseHeader(meta)}）的四轮决策博弈我走完了。`,
    "",
    "【我的决策轨迹】" + trajectory,
    `【统计】踩坑 ${misses} 次，用过 ${hints} 次提示。`,
    "【这一局的总结】" + summary,
    "",
    "请帮我做一次总复盘：",
    "1. 我踩坑的那几轮，共同的思维习惯是什么；",
    "2. 这四个岔路口之间有什么因果链，为什么前一轮的选择会限制后一轮的空间；",
    "3. 如果要把这套判断迁移到别的生成模型上，最该先看哪一个指标。",
  ].join("\n");
}
