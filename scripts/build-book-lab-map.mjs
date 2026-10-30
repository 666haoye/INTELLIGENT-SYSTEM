/**
 * 教材 ↔ 沙盒实验 / 案例库 映射表转换器。
 *
 *   输入：教材实验案例映射表.md（Workbuddy 用 PyMuPDF 实读页码校对过）
 *   输出：src/data/book-lab-map.ts（纯数据，运行时归属计算在 src/lib/knowledge-links.ts）
 *
 * 页码口径与全站一致：印刷页 = PDF 物理页 − 28。MD 两列都给，本脚本逐行复核这个等式。
 *
 * 为什么要留这个脚本而不是手写 TS：这张表是人工核对的产物，会随章节推进继续加行。
 * 每次改完 MD 重跑一次，脚本会把每一行解析到哪个条目、落点卡片叫什么名字打印出来，
 * 名称对不上的单独列 WARN —— 报告本身就是验收依据，不用等 UI 出来才发现挂错。
 *
 * 运行：node scripts/build-book-lab-map.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const markdownPath = path.join(root, "教材实验案例映射表.md");
const knowledgeBasePath = path.join(root, "src", "data", "knowledge-base.ts");
const experimentsPath = path.join(root, "src", "data", "experiments.ts");
const caseLibraryPath = path.join(root, "src", "data", "case-library.ts");
const outputPath = path.join(root, "src", "data", "book-lab-map.ts");
const pdfOffset = 28;

const failures = [];
const check = (label, ok, detail = "") => {
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
};

/* ---------- 现有数据 ---------- */

function sliceExportJson(file, anchor) {
  const source = fs.readFileSync(file, "utf8");
  const marker = source.search(anchor);
  if (marker < 0) throw new Error(`在 ${file} 里找不到 ${anchor}`);
  const start = source.indexOf("{", source.indexOf("=", marker));
  const end = source.lastIndexOf("}");
  return JSON.parse(source.slice(start, end + 1));
}

const knowledgeBase = sliceExportJson(
  knowledgeBasePath,
  /^export const knowledgeBase/m,
);
const experimentSource = fs.readFileSync(experimentsPath, "utf8");
const caseSource = fs.readFileSync(caseLibraryPath, "utf8");

/** experiments.ts 是 TS 字面量（`code: "E04"`），case-library.ts 是 JSON 风格（`"code": "C01"`）。 */
const experimentCodes = [...experimentSource.matchAll(/code:\s*"(E\d+)"/g)].map((m) => m[1]);
const flowerCaseCodes = [...caseSource.matchAll(/"code":\s*"(C\d+)"/g)].map((m) => m[1]);

/* ---------- 解析 MD ---------- */

const rows = fs
  .readFileSync(markdownPath, "utf8")
  .split(/\r?\n/)
  .filter((line) => /^\|\s*[^|\s-]/.test(line) && /\|\s*P\.\d+\s*\|\s*P\.\d+\s*\|/.test(line))
  .map((line) => {
    const cells = line.split("|").map((s) => s.trim()).slice(1, -1);
    return {
      pointName: cells[0],
      physicalPage: Number(cells[1].replace(/^P\./, "")),
      printedPage: Number(cells[2].replace(/^P\./, "")),
      /* 关联列原文是「实验 E04」「案例 C01 · 实验 E27」「实验 E11、E12」，
         按分隔符切会连着「实验 / 案例」前缀一起留下，所以直接全局抓编号再按首字母分流。 */
      codes: (cells[3].match(/[EC]\d{2}/g) ?? []),
      reason: cells.slice(4).join(" | "),
    };
  });

check("解析出 29 行映射", rows.length === 29, `实际 ${rows.length}`);
check(
  "每行 印刷页 === 物理页 − 28",
  rows.every((r) => r.physicalPage - pdfOffset === r.printedPage),
  rows.filter((r) => r.physicalPage - pdfOffset !== r.printedPage).map((r) => `${r.pointName.slice(0, 12)}@P.${r.printedPage}`).join(" "),
);

const expCodes = [...new Set(rows.flatMap((r) => r.codes.filter((c) => c[0] === "E")))];
const caseCodes = [...new Set(rows.flatMap((r) => r.codes.filter((c) => c[0] === "C")))];
const danglingExp = expCodes.filter((c) => !experimentCodes.includes(c));
const danglingCase = caseCodes.filter((c) => !flowerCaseCodes.includes(c));
check("表里的实验编号都存在于 experiments.ts", danglingExp.length === 0, danglingExp.join(","));
check("表里的案例编号都存在于 case-library.ts", danglingCase.length === 0, danglingCase.join(","));
check("10 个实验全部有归属", expCodes.length === 10, `实际 ${expCodes.length}：${expCodes.join(",")}`);
check("C01–C10 全部有归属", caseCodes.length === 10, `实际 ${caseCodes.length}：${caseCodes.join(",")}`);

/* ---------- 覆盖区间解析到条目（与 knowledge-links.ts 同一套语义） ---------- */

const spans = knowledgeBase.chapters
  .map((chapter) => {
    const m = chapter.pages.match(/(\d+)\s*-\s*(\d+)/);
    return m ? { name: chapter.name, from: Number(m[1]), to: Number(m[2]) } : null;
  })
  .filter((s) => s !== null);

const entriesByChapter = new Map();
for (const point of knowledgeBase.points) {
  for (const name of point.chapters ?? [point.chapter]) {
    const span = spans.find((s) => s.name === name);
    if (!span) continue;
    for (const page of point.pages ?? [point.page]) {
      if (page < span.from || page > span.to) continue;
      const list = entriesByChapter.get(name);
      if (list) list.push({ point, page });
      else entriesByChapter.set(name, [{ point, page }]);
    }
  }
}
for (const list of entriesByChapter.values()) {
  list.sort((a, b) => a.page - b.page || a.point.id - b.point.id);
}

function resolvePage(page) {
  const span = spans.find((s) => page >= s.from && page <= s.to);
  if (!span) return null;
  const entries = entriesByChapter.get(span.name) ?? [];
  if (entries.length === 0) return null;
  let covering = null;
  for (const entry of entries) {
    if (entry.page <= page) covering = entry;
    else break;
  }
  return (covering ?? entries[0]).point;
}

/* 名称比对用二元组重叠：P.97「容量、过拟合与欠拟合」和卡片「过拟合与欠拟合…」字序不同但确实是同一段，
   整串包含会误判；而 P.42「主成分分析」vs「迹的性质」一个二元组都对不上，才是真错。 */
const shingles = (text) => {
  const clean = text.replace(
    /[\s　（）()·、，,；;：:／/—–\-*★"“”]+/g,
    "",
  );
  const out = new Set();
  for (let i = 0; i < clean.length - 1; i += 1) out.add(clean.slice(i, i + 2));
  return out;
};
const sharesToken = (a, b) => {
  const sa = shingles(a);
  for (const token of shingles(b)) if (sa.has(token)) return true;
  return false;
};

const landing = [];
const warnings = [];
let unresolved = 0;
for (const row of rows) {
  const point = resolvePage(row.printedPage);
  if (!point) {
    unresolved += 1;
    warnings.push(`P.${row.printedPage} 在 288 条里解析不到任何条目 —— ${row.pointName}`);
    continue;
  }
  const label = String(point.name || point.section || point.summary);
  if (!sharesToken(row.pointName, label)) {
    warnings.push(
      `P.${row.printedPage} 表里写「${row.pointName.slice(0, 22)}」，落点是 #${point.id}「${label.slice(0, 22)}」`,
    );
  }
  landing.push({ row, point, label });
}
check("29 行全部能解析到条目", unresolved === 0, `${unresolved} 行落空`);

const distinctPoints = new Set(landing.map((l) => l.point.id));
const expButtons = landing.reduce((n, l) => n + l.row.codes.filter((c) => c[0] === "E").length, 0);
const caseButtons = landing.reduce((n, l) => n + l.row.codes.filter((c) => c[0] === "C").length, 0);
console.log(
  `  · 落点条目 ${distinctPoints.size} 个；按钮 实验 ${expButtons} + 案例 ${caseButtons}（同条目同编号会合并，实际渲染数以去重后为准）`,
);

/* ---------- 自检：按条目去重后的渲染预期 ---------- */

const byPoint = new Map();
for (const { row, point } of landing) {
  const cur = byPoint.get(point.id) ?? { exp: [], cas: [], point };
  for (const code of row.codes) {
    const bucket = code[0] === "E" ? cur.exp : cur.cas;
    if (!bucket.includes(code)) bucket.push(code);
  }
  byPoint.set(point.id, cur);
}
console.log(
  `  · 去重后：${byPoint.size} 张卡片有按钮，实验 ${[...byPoint.values()].reduce((n, v) => n + v.exp.length, 0)} 个 / 案例 ${[...byPoint.values()].reduce((n, v) => n + v.cas.length, 0)} 个`,
);
for (const [id, v] of [...byPoint.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(
    `      #${String(id).padEnd(4)} ${(v.point.name || v.point.section || "").slice(0, 20).padEnd(22)}` +
      `${v.exp.map((c) => "🚀" + c).join(" ")} ${v.cas.map((c) => "📁" + c).join(" ")}`,
  );
}

console.log(`\n  · 名称对不上的 WARN ${warnings.length} 条：`);
warnings.forEach((w) => console.log(`      ${w}`));

/* ---------- 写出 ---------- */

const header = `/* Generated by scripts/build-book-lab-map.mjs — do not edit by hand.
 * 源：教材实验案例映射表.md（Workbuddy 用 PyMuPDF 实读页码校对）。改那张 MD 后重跑脚本。
 *
 * 这里只放数据。运行时「哪张卡有哪几个按钮」由 src/lib/knowledge-links.ts 的 LAB_BY_POINT 算：
 * 用 printedPage 走 resolvePageToKnowledgeTarget 的**覆盖区间**语义（和 kb:// 深链同一套），
 * 而不是要求页码精确相等 —— 尾部第 8–20 章是粗粒度条目，MD 里 P.372/373/386/391/404/406
 * 这几页在表里根本不存在，精确匹配会让 E13/E33 少入口、C01/C05/C06/C07 四个案例彻底挂不上。
 *
 * pointName / physicalPage / reason 都不参与匹配，只作溯源与按钮提示文案。
 * 页码一律是**印刷页码**，物理页 = 印刷页 + ${pdfOffset}。
 */

export type BookLabMapRow = {
  /** MD 里的「知识点名称」，人类可读溯源用 */
  pointName: string;
  /** 印刷页码，LAB_BY_POINT 用它做覆盖区间反查 */
  printedPage: number;
  /** PDF 物理页码，= printedPage + ${pdfOffset}，留着对账 */
  physicalPage: number;
  expCodes: string[];
  caseCodes: string[];
  /** 「关联原因简述」，直接当按钮的 title */
  reason: string;
};

export const bookLabMapRows: BookLabMapRow[] = `;

const payload = landing.map(({ row }) => ({
  pointName: row.pointName,
  printedPage: row.printedPage,
  physicalPage: row.physicalPage,
  expCodes: row.codes.filter((c) => c[0] === "E"),
  caseCodes: row.codes.filter((c) => c[0] === "C"),
  reason: row.reason,
}));

/* 一行一条，方便 git diff 看出改了哪一行映射；JSON.stringify 负责转义 reason 里的引号。 */
const body = `[\n${payload.map((row) => `  ${JSON.stringify(row)}`).join(",\n")}\n]`;
fs.writeFileSync(outputPath, `${header}${body};\n`, "utf8");

const written = fs.readFileSync(outputPath, "utf8");
const writtenRows = (written.match(/^ {2}\{/gm) ?? []).length;
check("产物行数 = 29", writtenRows === 29, `实际 ${writtenRows}`);
check(
  "产物里每一行的两个编号数组非空且合计对得上",
  payload.every((r) => r.expCodes.length + r.caseCodes.length > 0) &&
    payload.reduce((n, r) => n + r.expCodes.length + r.caseCodes.length, 0) ===
      expButtons + caseButtons,
);

console.log(`\n写出 ${outputPath} —— ${payload.length} 行`);
if (failures.length) {
  console.error(`\n${failures.length} 项自检未通过：\n  ${failures.join("\n  ")}`);
  process.exitCode = 1;
}
