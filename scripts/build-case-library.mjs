#!/usr/bin/env node
/**
 * 从 资料库/案例库/ 的两份 Markdown 生成 src/data/case-library.ts。
 * 生成物，勿手改；改了源必须重跑 npm run qa:cases。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC_DIR = path.join(ROOT, "资料库", "案例库");
const OUT = path.join(ROOT, "src", "data", "case-library.ts");

/** 真实存在的实验编号集合，与 src/data/experiments.ts 保持一致 */
const KNOWN_EXPERIMENTS = new Set([
  "E04", "E08", "E11", "E12", "E13", "E21", "E22", "E27", "E32", "E33",
]);

/** 从 knowledge-base.ts 里截出 JSON 块，用于按页码反查章名 */
function loadKnowledgeChapters() {
  const src = fs.readFileSync(
    path.join(ROOT, "src", "data", "knowledge-base.ts"),
    "utf8",
  );
  const marker = "export const knowledgeBase";
  let i = src.indexOf(marker);
  if (i < 0) throw new Error("未找到 knowledgeBase 声明");
  i = src.indexOf("{", i);
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let j = i; j < src.length; j += 1) {
    const c = src[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        end = j;
        break;
      }
    }
  }
  const kb = JSON.parse(src.slice(i, end + 1));
  return kb.chapters.map((chapter) => {
    const m = chapter.pages.match(/([0-9]+)\s*-\s*([0-9]+)/);
    return { name: chapter.name, from: Number(m[1]), to: Number(m[2]) };
  });
}

function chapterForFlowerPage(chapters, page) {
  const span = chapters.find((c) => page >= c.from && page <= c.to);
  return span ? span.name : "《深度学习》中文版";
}

function parseFormalCases(text) {
  const cases = [];
  let cur = null;
  let inOptions = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();

    const head = line.match(/^### 案例 (C\d+)\s*$/);
    if (head) {
      cur = { code: head[1], fields: {}, options: [] };
      cases.push(cur);
      inOptions = false;
      continue;
    }
    if (!cur) continue;

    if (/^- \*\*情景推演选项\*\*/.test(line)) {
      inOptions = true;
      continue;
    }

    const opt = line.match(/^- ([A-Z])\. (.+)$/);
    if (opt && inOptions) {
      cur.options.push({ key: opt[1], text: opt[2].trim() });
      continue;
    }

    const field = line.match(/^- \*\*(.+?)\*\*：(.*)$/);
    if (field) {
      inOptions = false;
      cur.fields[field[1]] = field[2].trim();
    }
  }
  return cases;
}

function parseMicroCases(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(
      /^\|\s*(n\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/,
    );
    if (m) {
      rows.push({
        id: m[1],
        concept: m[2],
        example: m[3],
        chapter: m[4],
        link: m[5],
      });
    }
  }
  return rows;
}

function build() {
  const chapters = loadKnowledgeChapters();
  const formalRaw = parseFormalCases(
    fs.readFileSync(
      path.join(SRC_DIR, "案例库_统一结构化_含教材实战.md"),
      "utf8",
    ),
  );
  const microRaw = parseMicroCases(
    fs.readFileSync(
      path.join(SRC_DIR, "02 教学微案例（8条）.md"),
      "utf8",
    ),
  );

  const problems = [];
  const nullPage = [];
  const missingExp = [];

  if (formalRaw.length !== 23) {
    problems.push("正式案例数 = " + formalRaw.length + "，期望 23");
  }
  if (microRaw.length !== 8) {
    problems.push("微案例数 = " + microRaw.length + "，期望 8");
  }

  const formalCases = formalRaw.map((item) => {
    const number = Number(item.code.slice(1));
    const track = number <= 10 ? "research" : "practice";
    const source = number <= 10 ? "flower" : "tensorflow";

    const rawPage = item.fields["教材页码"] ?? "";
    const page = /^\d+$/.test(rawPage) ? Number(rawPage) : null;
    if (page === null) nullPage.push(item.code + "（原文：" + rawPage + "）");

    const rawExp = item.fields["对应实验"] ?? "null";
    const experimentCode = rawExp === "null" ? null : rawExp;
    if (experimentCode && !KNOWN_EXPERIMENTS.has(experimentCode)) {
      missingExp.push(item.code + " -> " + experimentCode);
    }

    if (!item.options.length) problems.push(item.code + " 没有解析到任何选项");
    const correctKey = item.fields["正确选项"];
    if (!item.options.some((o) => o.key === correctKey)) {
      problems.push(
        item.code + " 的正确选项 " + correctKey + " 不在选项集合内",
      );
    }
    for (const key of ["01 问题", "02 方法", "03 结果", "04 启示"]) {
      if (!item.fields[key]) problems.push(item.code + " 缺字段 " + key);
    }

    const title = item.fields["标题"] ?? "";
    const section = title.match(/^(\d+(?:\.\d+)*)\s/);

    return {
      id: item.code.toLowerCase(),
      code: item.code,
      title,
      domain: item.fields["领域"] ?? "",
      track,
      year: item.fields["年份"] ?? "",
      keywords: (item.fields["标签"] ?? "")
        .split(",")
        .map((keyword) => keyword.trim())
        .filter(Boolean),
      source,
      page,
      experimentCode,
      chapter:
        source === "flower" && page !== null
          ? chapterForFlowerPage(chapters, page)
          : "《TensorFlow 深度学习》" + (section ? "§" + section[1] : ""),
      options: item.options,
      correctKey,
      problem: item.fields["01 问题"],
      method: item.fields["02 方法"],
      result: item.fields["03 结果"],
      lesson: item.fields["04 启示"],
    };
  });

  const seen = new Set();
  for (const item of formalCases) {
    if (seen.has(item.id)) problems.push("重复 id: " + item.id);
    seen.add(item.id);
  }

  const domains = [
    ...new Set(
      formalCases
        .map((item) => item.domain.split(" / ")[0].trim())
        .filter(Boolean),
    ),
  ];

  console.log(
    "[qa:cases] 正式案例 " + formalCases.length + " 条（research " +
      formalCases.filter((c) => c.track === "research").length + " / practice " +
      formalCases.filter((c) => c.track === "practice").length + "），微案例 " +
      microRaw.length + " 条，领域大类 " + domains.length + " 种",
  );
  console.log(
    "[qa:cases] 页码非数字（已置 null）：" + (nullPage.join(", ") || "无"),
  );
  console.log(
    "[qa:cases] 警告 · 实验编号不存在于沙盒：" + (missingExp.join(", ") || "无"),
  );

  if (problems.length) {
    console.error("[qa:cases] 校验失败：\n  " + problems.join("\n  "));
    process.exit(1);
  }

  const payload = {
    title: "深度学习案例库",
    kicker: "先推演，再看当年真实的选择与结果",
    source:
      "《深度学习》（Goodfellow / Bengio / Courville）中文版 与 《TensorFlow 深度学习》（龙良曲）",
    note: "C01–C10 页码出自花书，可跳转知识库；C11–C23 页码出自《TensorFlow 深度学习》，本知识库未收录。印刷页码 + 28 = PDF 阅读器页码。",
    pageOffset: 28,
    domains,
    formalCases,
    microCases: microRaw,
  };

  const file = `/* 生成物：由 scripts/build-case-library.mjs 从 资料库/案例库/ 的 Markdown 生成。
 * 不要手改本文件 —— 改源 MD 后执行 npm run qa:cases 重新生成。 */

export type CaseSource = "flower" | "tensorflow";
export type CaseTrack = "research" | "practice";

export type ScenarioOption = { key: string; text: string };

export type FormalCase = {
  id: string;
  code: string;
  title: string;
  /** 细类，如「工程实践 / 反向传播」；筛选按 " / " 前缀归并成大类 */
  domain: string;
  track: CaseTrack;
  /** 字符串：实战案例的年份带括注，如「2020（教材实战）」 */
  year: string;
  keywords: string[];
  source: CaseSource;
  /** 印刷页码；源文件里不是纯数字的（如 C15）为 null */
  page: number | null;
  /** 配套实验编号；可能指向尚未开发的实验，渲染前必须校验 */
  experimentCode: string | null;
  chapter: string;
  options: ScenarioOption[];
  correctKey: string;
  problem: string;
  method: string;
  result: string;
  lesson: string;
};

export type MicroCase = {
  id: string;
  concept: string;
  example: string;
  chapter: string;
  link: string;
};

export type CaseLibrary = {
  title: string;
  kicker: string;
  source: string;
  note: string;
  pageOffset: number;
  /** 按 " / " 前缀归并后的大类，用于筛选下拉 */
  domains: string[];
  formalCases: FormalCase[];
  microCases: MicroCase[];
};

export const caseLibrary: CaseLibrary = ${JSON.stringify(payload, null, 2)};
`;

  fs.writeFileSync(OUT, file, "utf8");
  console.log("[qa:cases] 已生成 " + OUT);
}

build();
