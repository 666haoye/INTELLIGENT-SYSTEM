/**
 * Build the question-oriented search index from:
 * - src/data/knowledge-base.ts (169 point anchors, page numbers)
 * - 资料库/知识库/*.md (20 chapter notes, appendices, terminology)
 *
 * Run: node scripts/build-question-index.mjs
 * Output: src/data/question-index.ts
 *
 * The runtime never reads 资料库 directly; this script is the only build-time
 * dependency on the source materials.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const knowledgeBasePath = path.join(root, "src", "data", "knowledge-base.ts");
const notesRoot = path.join(root, "资料库", "知识库");
const outputPath = path.join(root, "src", "data", "question-index.ts");

function extractKnowledgeBase() {
  const source = fs.readFileSync(knowledgeBasePath, "utf8");
  const marker = source.indexOf("export const knowledgeBase");
  const assignment = source.indexOf("=", marker);
  const start = source.indexOf("{", assignment);
  const end = source.lastIndexOf("}");
  if (marker < 0 || assignment < 0 || start < 0 || end <= start) {
    throw new Error("Cannot locate knowledgeBase object");
  }
  return JSON.parse(source.slice(start, end + 1));
}

function listMarkdownFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listMarkdownFiles(full));
    else if (entry.name.endsWith(".md")) files.push(full);
  }
  return files;
}

function parsePageStart(pages) {
  const match = String(pages ?? "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

function cleanMarkdown(text) {
  return text
    .replace(/\*本页由[\s\S]*$/g, "")
    .replace(/^---\s*$/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSection(markdown, matcher) {
  const lines = markdown.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i]) && matcher(lines[i].replace(/^##\s+/, "").trim())) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return "";

  const collected = [];
  for (let i = start; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) break;
    if (/^---\s*$/.test(lines[i])) break;
    collected.push(lines[i]);
  }
  return cleanMarkdown(collected.join("\n"));
}

function chapterForPage(chapters, page) {
  if (!page) return null;
  for (const chapter of chapters) {
    const match = String(chapter.pages).match(/(\d+)\s*[-–]\s*(\d+)/);
    if (!match) continue;
    if (page >= Number(match[1]) && page <= Number(match[2])) return chapter;
  }
  return null;
}

const knowledgeBase = extractKnowledgeBase();
const chapters = knowledgeBase.chapters;
const markdownFiles = listMarkdownFiles(notesRoot);

const units = [];
const pointById = new Map(knowledgeBase.points.map((point) => [point.id, point]));

/* 169 point units: the primary answer/jump units. */
for (const point of knowledgeBase.points) {
  units.push({
    id: `point-${point.id}`,
    kind: "point",
    title: point.section,
    chapter: point.chapter,
    section: point.section,
    page: point.page,
    chapterPages: point.chapterPages,
    text: point.summary,
    terms: point.terms,
    target: { chapter: point.chapter, pointId: point.id },
  });
}

/* Chapter-note units: positioning, links, and pitfalls. */
const chapterNoteUnits = [];
for (const file of markdownFiles) {
  const base = path.basename(file, ".md");
  if (/^(00|附录)/.test(base)) continue;

  const markdown = fs.readFileSync(file, "utf8");
  const h1 = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? base;
  const chapter = chapters.find(
    (item) => h1.includes(item.name) || base.includes(item.name),
  );
  if (!chapter) {
    console.warn("Skipping unmatched chapter note:", file);
    continue;
  }

  const chapterPointTerms = [
    ...new Set(
      knowledgeBase.points
        .filter((point) => point.chapter === chapter.name)
        .flatMap((point) => point.terms),
    ),
  ];

  const sections = [
    ["本章定位", (title) => title === "本章定位"],
    ["与其他章节的联系", (title) => title.includes("与其他章节的联系")],
    ["易错点 / 考点", (title) => title.includes("易错点")],
  ];

  for (const [label, matcher] of sections) {
    const text = extractSection(markdown, matcher);
    if (!text) continue;
    const unit = {
      id: `chapter-${chapter.name}-${label}`,
      kind: "chapter",
      title: `${chapter.name} · ${label}`,
      chapter: chapter.name,
      section: label,
      page: parsePageStart(chapter.pages),
      chapterPages: chapter.pages,
      text,
      terms: [chapter.name, ...chapterPointTerms].slice(0, 30),
      target: { chapter: chapter.name },
    };
    units.push(unit);
    chapterNoteUnits.push(unit);
  }
}

/* Appendix A formula units. They map back to a chapter (and a point when possible). */
const formulaUnits = [];
const appendixA = markdownFiles.find((file) => path.basename(file).startsWith("附录A"));
if (appendixA) {
  const lines = fs.readFileSync(appendixA, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
    if (cells.length < 3) continue;
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
    if (cells[0] === "公式") continue;

    const pageMatch = cells[cells.length - 1].match(/\d+/);
    if (!pageMatch) continue;
    const page = Number(pageMatch[0]);
    const chapter = chapterForPage(chapters, page);
    if (!chapter) continue;

    const formula = cleanMarkdown(cells[0]);
    const meaning = cleanMarkdown(cells[1]);
    const point = knowledgeBase.points.find(
      (item) => item.chapter === chapter.name && item.page === page,
    );

    const unit = {
      id: `formula-${page}-${formulaUnits.length}`,
      kind: "formula",
      title: meaning || formula,
      chapter: chapter.name,
      section: "附录 A 核心公式速查",
      page,
      chapterPages: chapter.pages,
      text: `${formula}${meaning ? `；含义：${meaning}` : ""}`,
      terms: [],
      target: { chapter: chapter.name, ...(point ? { pointId: point.id } : {}) },
    };
    units.push(unit);
    formulaUnits.push(unit);
  }
}

/* Appendix B terms: used for query expansion and page/section hints. */
const glossary = [];
const appendixB = markdownFiles.find((file) => path.basename(file).startsWith("附录B"));
if (appendixB) {
  const lines = fs.readFileSync(appendixB, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
    if (cells.length < 4) continue;
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
    if (cells[0] === "术语") continue;
    const pageMatch = cells[1].match(/\d+/);
    glossary.push({
      term: cells[0],
      page: pageMatch ? Number(pageMatch[0]) : null,
      chapter: cells[2].split(/[；;]/)[0].trim(),
      section: cells[3].trim(),
    });
  }
}

/* Curated starter questions, grounded in the overview's "高频速查" and chapter pitfalls. */
const starterQuestions = [
  { id: "q01", category: "训练排障", text: "过拟合有哪些缓解方法？" },
  { id: "q02", category: "训练排障", text: "训练 loss 不下降或震荡时怎么排查？" },
  { id: "q03", category: "模型结构", text: "CNN 的卷积层和池化层分别在做什么？" },
  { id: "q04", category: "模型结构", text: "LSTM 怎么缓解梯度消失？" },
  { id: "q05", category: "模型结构", text: "注意力机制解决了编码器-解码器的什么问题？" },
  { id: "q06", category: "训练排障", text: "Dropout 为什么能防止过拟合？" },
  { id: "q07", category: "数学基础", text: "KL 散度与交叉熵是什么关系？" },
  { id: "q08", category: "数学基础", text: "SVD 和特征分解有什么关系？" },
  { id: "q09", category: "生成模型", text: "VAE 的 ELBO 是什么？" },
  { id: "q10", category: "生成模型", text: "GAN 如何通过对抗训练生成图像？" },
  { id: "q11", category: "概念解释", text: "什么是表示学习？" },
  { id: "q12", category: "概念解释", text: "偏差和方差怎么权衡？" },
  { id: "q13", category: "训练排障", text: "BatchNorm 在小 batch 下为什么容易失效？" },
  { id: "q14", category: "实践方法", text: "怎么调超参数、怎么调试模型？" },
  { id: "q15", category: "数学基础", text: "反向传播如何计算梯度？" },
  { id: "q16", category: "概念解释", text: "为什么深度网络需要非线性激活函数？" },
  { id: "q17", category: "模型结构", text: "动量法和 Adam 有什么区别？" },
  { id: "q18", category: "概念解释", text: "自编码器和 PCA 有什么关系？" },
  { id: "q19", category: "训练排障", text: "梯度爆炸应该如何处理？" },
  { id: "q20", category: "实践方法", text: "为什么要使用验证集？" },
];

const synonyms = [
  ["cnn", "卷积神经网络", "卷积网络"],
  ["rnn", "循环神经网络", "递归神经网络"],
  ["lstm", "长短期记忆", "长短期记忆网络"],
  ["mlp", "多层感知机", "深度前馈网络", "前馈网络"],
  ["bn", "batchnorm", "批标准化", "批归一化"],
  ["ln", "layernorm", "层标准化", "层归一化"],
  ["gan", "生成对抗网络", "生成式对抗网络"],
  ["vae", "变分自编码器", "变分自动编码器"],
  ["ae", "自编码器", "自动编码器"],
  ["sgd", "随机梯度下降"],
  ["kl", "kl散度", "相对熵"],
  ["svd", "奇异值分解"],
  ["pca", "主成分分析"],
  ["elbo", "证据下界"],
  ["relu", "线性整流单元"],
  ["ctc", "连接时序分类"],
  ["dropout", "随机失活"],
  ["l1", "l1正则化", "lasso"],
  ["l2", "l2正则化", "权重衰减", "ridge"],
  ["梯度消失", "vanishing gradient"],
  ["梯度爆炸", "exploding gradient"],
  ["过拟合", "overfitting"],
  ["欠拟合", "underfitting"],
  ["注意力", "attention"],
  ["encoder-decoder", "encoder", "decoder", "编码器", "解码器", "编码-解码", "编码解码", "seq2seq", "序列到序列"],
  ["loss", "损失函数", "代价函数", "成本函数"],
  ["验证集", "validation set", "开发集"],
  ["学习率", "learning rate"],
  ["正则化", "regularization"],
  ["优化器", "optimizer"],
];

const stats = {
  points: knowledgeBase.points.length,
  chapters: chapters.length,
  chapterNotes: chapterNoteUnits.length,
  formulas: formulaUnits.length,
  terms: glossary.length,
  starterQuestions: starterQuestions.length,
  units: units.length,
};

const output = `// Generated by scripts/build-question-index.mjs.
// Sources: src/data/knowledge-base.ts + 资料库/知识库/*.md.
// Do not edit by hand; rerun the build script when the source material changes.

export type SearchUnitKind = "point" | "chapter" | "formula";

export type UnitTarget = {
  chapter: string;
  pointId?: number;
};

export type SearchUnit = {
  id: string;
  kind: SearchUnitKind;
  title: string;
  chapter: string;
  section: string;
  page?: number;
  chapterPages?: string;
  text: string;
  terms: string[];
  target: UnitTarget;
};

export type GlossaryTerm = {
  term: string;
  page: number | null;
  chapter: string;
  section: string;
};

export type StarterQuestion = {
  id: string;
  category: string;
  text: string;
};

export type QuestionIndexStats = {
  points: number;
  chapters: number;
  chapterNotes: number;
  formulas: number;
  terms: number;
  starterQuestions: number;
  units: number;
};

export type QuestionIndex = {
  stats: QuestionIndexStats;
  units: SearchUnit[];
  glossary: GlossaryTerm[];
  starterQuestions: StarterQuestion[];
  synonyms: string[][];
};

export const questionIndex: QuestionIndex = ${JSON.stringify(
  { stats, units, glossary, starterQuestions, synonyms },
  null,
  2,
)};
`;

fs.writeFileSync(outputPath, output, "utf8");
console.log("wrote", outputPath);
console.log(stats);
console.log("chapter note unit samples:");
for (const unit of chapterNoteUnits.slice(0, 4)) {
  console.log("-", unit.title, "|", unit.text.slice(0, 80));
}
console.log("formula samples:");
for (const unit of formulaUnits.slice(0, 4)) {
  console.log("-", unit.title, "| p", unit.page, "|", unit.chapter);
}
console.log("glossary sample:", glossary.slice(0, 3));
