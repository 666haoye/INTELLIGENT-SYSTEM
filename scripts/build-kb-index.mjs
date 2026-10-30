/**
 * 知识库索引转换器。
 *
 *   输入：知识库材料/核心知识点清单_全量合并.md（Workbuddy 提取合并的 184 条，第 1–7 章）
 *         + 现存的 src/data/knowledge-base.ts（旧的 169 条）
 *   输出：src/data/knowledge-base.ts —— 第 1–7 章换成新的 184 条，第 8–20 章保留旧的 104 条，共 288 条。
 *
 * 为什么是并集而不是纯替换：新清单只到物理页 262（印刷 234），旧索引覆盖到印刷 613。
 * 纯替换会让案例库 8 个「查看对应教材」按钮、kb:// >P.234 的 AI 联动、
 * E13/E22/E27/E32/E33 的实验关联、问题面板 ch8–20 的跳转一起失效。
 * 等第 4 批清单出来，把 LEGACY_TAIL 的起点从 chapters[7] 往前挪即可逐章替换。
 *
 * 页码换算（和 kb-data.ts 同一口径，别改）：
 *   印刷页 = 物理 PDF 页 − 28。清单里的 `P.NNN` 是**物理页**（_build_kb.py 用 doc[page_no-1] 裁页），
 *   而 UI 与 knowledgeBase.pdfOffset 说的都是印刷页。
 *
 * 重编号的代价与补救：
 *   question-index.ts 是冻结快照（资料库/ 已不存在，build-question-index.mjs 跑不起来），
 *   它的 169 个 point unit 仍带旧 pointId。新表里每条都带 `legacyIds`，
 *   KnowledgePanel 靠它把旧 id 反查成新 id，查不到就退到章锚点 —— 宁可落章头，也不能落错卡。
 *
 * 运行：node scripts/build-kb-index.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const markdownPath = path.join(root, "知识库材料", "核心知识点清单_全量合并.md");
const knowledgeBasePath = path.join(root, "src", "data", "knowledge-base.ts");
const pdfOffset = 28;

/** 切片 → 概念宿主的期望落点，由 `知识库材料/kb_export/kb_data.json` 的物理页反查得到。 */
const EXPECTED_HOSTS = [
  ["sgd", [42, 160], 14],
  ["backprop", [44, 203], 16],
  ["gradient-descent", [103], 67],
  ["overfitting", [226], 78],
  ["regularization", [225], 81],
  ["l2-penalty", [227], 149],
  ["l1-penalty", [232], 154],
  ["data-augmentation", [235], 157],
  ["early-stopping", [240], 162],
  ["dropout", [251], 173],
];

const failures = [];
const check = (label, ok, detail = "") => {
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
};

/* ---------- 读旧表 ---------- */

function readExisting() {
  if (!fs.existsSync(knowledgeBasePath)) return null;
  const source = fs.readFileSync(knowledgeBasePath, "utf8");
  /* 行首锚定：两个 build 脚本用的是裸 indexOf，头注释里一旦提前写出那行 export 原文就会切错。
     自己读的这遍必须比它们更稳，否则本脚本会被上一轮的产物卡死。 */
  const marker = source.search(/^export const knowledgeBase/m);
  if (marker < 0) return null;
  const start = source.indexOf("{", source.indexOf("=", marker));
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return JSON.parse(source.slice(start, end + 1));
}

const existing = readExisting();
if (!existing) throw new Error("读不到现有的 knowledge-base.ts，章节元数据无处可取");

const chapters = existing.chapters;
if (chapters.length !== 20) throw new Error(`期望 20 章元数据，实际 ${chapters.length}`);

/* 新条目带 relevance；旧条目没有。这就是「哪些还没被替换」的判据，重跑也不会认错。 */
const isFresh = (point) => typeof point.relevance === "string";
const firstSevenChapterNames = new Set(chapters.slice(0, 7).map((c) => c.name));

const legacyTail = existing.points
  .filter((p) => !isFresh(p) && !firstSevenChapterNames.has(p.chapter))
  .sort((a, b) => (a.legacyIds?.[0] ?? a.id) - (b.legacyIds?.[0] ?? b.id));
const oldHeadPoints = existing.points.filter(
  (p) => !isFresh(p) && firstSevenChapterNames.has(p.chapter),
);
const carriedLegacy = new Map(
  existing.points.filter(isFresh).map((p) => [p.id, p.legacyIds ?? []]),
);

console.log(
  `旧表 ${existing.points.length} 条 → 待替换的第 1–7 章 ${oldHeadPoints.length} 条，保留的尾部 ${legacyTail.length} 条`,
);

/* ---------- 解析清单 ---------- */

const rows = fs
  .readFileSync(markdownPath, "utf8")
  .split(/\r?\n/)
  .filter((line) => /^\|\s*\d+\s*\|/.test(line));

const FULL_WIDTH_TAIL = /^(.*?)（([^（）]+)）\s*$/;
const HALF_WIDTH_TAIL = /^(.*?)\(([^()]+)\)\s*$/;
const LEADING_SECTION = /^(\d+(?:\.\d+)+)\s+/;
const TERM_STOP = new Set([
  "vs", "et", "al", "of", "in", "the", "and", "for", "with", "not", "is", "are", "to",
]);

/**
 * 「early stopping」「logistic sigmoid」「kernel trick」这类连写词组是一个概念，
 * 拆成两个 chip 就没意义了；但源文本里也有「Dropout vs Bagging」「Montufar et al.」，
 * 所以合并后要把尾部的连接词削掉。
 */
function extractTerms(text) {
  const latin =
    text.match(/[A-Za-z][A-Za-z0-9.'-]*(?:[ \t]+[a-z][A-Za-z0-9.'-]*)*/g) ?? [];
  const greek = text.match(/[α-ωΑ-Ω˜]/g) ?? [];
  const found = [];
  for (const raw of [...latin, ...greek]) {
    const words = raw.split(/[ \t]+/).map((word) => word.replace(/^[.'-]+|[.'-]+$/g, ""));
    while (words.length > 1 && TERM_STOP.has(words[words.length - 1].toLowerCase())) {
      words.pop();
    }
    const term = words.join(" ");
    if (term.length < 2) continue;
    if (TERM_STOP.has(term.toLowerCase())) continue;
    if (!found.some((kept) => kept.toLowerCase() === term.toLowerCase())) found.push(term);
  }
  return found.slice(0, 4);
}

function parseName(raw) {
  const stripped = raw.replace(/★/g, "").replace(/\s+/g, " ").trim();
  const matched = stripped.match(FULL_WIDTH_TAIL) ?? stripped.match(HALF_WIDTH_TAIL);
  const head = matched ? matched[1].trim() : stripped;
  const detail = matched ? matched[2].trim() : "";
  const sectionMatch = head.match(LEADING_SECTION);
  return {
    section: sectionMatch ? sectionMatch[1] : "",
    name: sectionMatch ? head.slice(sectionMatch[1].length).trim() : head,
    summary: detail,
    terms: extractTerms(stripped),
  };
}

/** 「第1章、第5章」→ 章名数组；序号直接对上 chapters 的下标，不猜中文数字。 */
function chapterNamesOf(label) {
  return label.split("、").map((part) => {
    const number = Number(part.match(/\d+/)?.[0]);
    const chapter = chapters[number - 1];
    if (!chapter) throw new Error(`章号「${part}」在第 1–7 章元数据里找不到`);
    return chapter.name;
  });
}

function spanOf(chapterName) {
  const chapter = chapters.find((item) => item.name === chapterName);
  const matched = chapter?.pages.match(/(\d+)\s*-\s*(\d+)/);
  return matched ? { from: Number(matched[1]), to: Number(matched[2]) } : null;
}

const fresh = rows.map((line) => {
  /*
   * ★ 合并行（14/16/39/78/81）的「校验锚点」里带 `|`，split 出来是 9 段不是 8 段。
   * 所以只从头部取序号/章节/名称、从尾部取关联度，中间整段 join 回去再抽页码。
   */
  const cells = line.split("|").map((s) => s.trim()).slice(1, -1);
  const physicalPages = cells
    .slice(3, cells.length - 1)
    .join("|")
    .match(/P\.(\d+)/g)
    .map((token) => Number(token.slice(2)));
  const id = Number(cells[0]);
  const names = chapterNamesOf(cells[1]);
  const primary = chapters.find((item) => item.name === names[0]);
  const printedPages = physicalPages.map((page) => page - pdfOffset);
  const parsed = parseName(cells[2]);

  return {
    id,
    part: primary.part,
    chapter: primary.name,
    chapterPages: primary.pages,
    section: parsed.section,
    summary: parsed.summary,
    terms: parsed.terms,
    page: printedPages[0],
    name: parsed.name,
    pages: printedPages,
    chapters: names,
    relevance: cells[cells.length - 1],
    legacyIds: [],
  };
});

/* ---------- 旧 ch1–7 → 新条目 ---------- */

/**
 * 先按节号（「7.1 参数范数惩罚」→ 7.1），再按同章 + 印刷页相等。
 * 只按页码会认错：旧 #52「7.1 参数范数惩罚」记的是印刷 198，
 * 而 198 在新表里属于 ★ 行 #78「过拟合与欠拟合」（物理 226），
 * 新 #149 才是 7.1（印刷 199）。宁可差一页，也不能跨语义。
 */
function leadingSection(text) {
  return text.match(/^(\d+(?:\.\d+)+)/)?.[1] ?? "";
}

let legacyCovered = 0;
const legacyHow = [];
for (const old of oldHeadPoints) {
  const oldSection = leadingSection(old.section);
  const bySection = oldSection
    ? fresh.filter((point) => point.section === oldSection)
    : [];
  const byPage = fresh.filter(
    (point) => point.chapters.includes(old.chapter) && point.pages.includes(old.page),
  );
  const host = bySection[0] ?? byPage[0];
  if (host) {
    if (!host.legacyIds.includes(old.id)) host.legacyIds.push(old.id);
    legacyCovered += 1;
    legacyHow.push(
      `    旧 #${String(old.id).padStart(3)} ${old.section.slice(0, 22) || old.summary.slice(0, 18)} (p${old.page}) → 新 #${host.id} ${host.name} [${bySection[0] ? "节号" : "页码"}]`,
    );
  } else {
    legacyHow.push(
      `    旧 #${String(old.id).padStart(3)} ${old.section.slice(0, 22) || old.summary.slice(0, 18)} (p${old.page}) → 无对应，退章锚点`,
    );
  }
}
/* 重跑时旧的第 1–7 章已经没了，直接沿用上一轮写进去的反查结果。 */
for (const point of fresh) {
  if (point.legacyIds.length === 0 && carriedLegacy.has(point.id)) {
    point.legacyIds = carriedLegacy.get(point.id);
  }
}

const tail = legacyTail.map((point, index) => {
  const legacyId = point.legacyIds?.[0] ?? point.id;
  const next = { ...point, id: fresh.length + index + 1 };
  delete next.legacyIds;
  /* 尾部条目没被替换过，它自己就是旧编号；反查表写成恒等，KnowledgePanel 只有一套逻辑。 */
  return { ...next, legacyIds: [legacyId] };
});

const points = [...fresh, ...tail];
const legacyTotal =
  fresh.reduce((sum, point) => sum + point.legacyIds.length, 0) + tail.length;

/* ---------- 自检 ---------- */

check("清单行数 = 184", fresh.length === 184, `实际 ${fresh.length}`);
check(
  "序号 1–184 连续",
  fresh.every((point, index) => point.id === index + 1),
);
check(
  "每条都有可显示的标题",
  points.every((p) => (p.name || p.section || p.summary).trim().length > 0),
);
check(
  "名称列里没有混进 | （否则 split 会把标题截断）",
  fresh.every((p) => !/[[\]|]/.test(`${p.name}${p.summary}`)),
);

const byPhysical = new Map();
for (const point of fresh) {
  for (const printed of point.pages) {
    const physical = printed + pdfOffset;
    if (!byPhysical.has(physical)) byPhysical.set(physical, []);
    byPhysical.get(physical).push(point.id);
  }
}

const hostIds = [];
for (const [kbId, physicalPages, expected] of EXPECTED_HOSTS) {
  const owners = [...new Set(physicalPages.map((page) => byPhysical.get(page)).flat())];
  const ok = owners.length === 1 && owners[0] === expected;
  check(
    `概念 ${kbId} 的切片页 ${JSON.stringify(physicalPages)} 唯一落在 #${expected}`,
    ok,
    ok ? "" : `实际 ${JSON.stringify(owners)}`,
  );
  hostIds.push(expected);
}
check("10 个宿主条目互不重复", new Set(hostIds).size === 10);

check(
  "新条目印刷页范围 = 1–234",
  Math.min(...fresh.map((p) => p.page)) === 1 &&
    Math.max(...fresh.flatMap((p) => p.pages)) === 234,
);
check("总条数 = 288", points.length === 288, `实际 ${points.length}`);
check("旧编号反查覆盖 162/169", legacyTotal === 162 || legacyTotal === 169, `实际 ${legacyTotal}`);
check(
  "章名全部落在 20 章元数据内",
  points.every((p) => (p.chapters ?? [p.chapter]).every((n) => chapters.some((c) => c.name === n))),
);

const relCount = fresh.reduce((map, p) => map.set(p.relevance, (map.get(p.relevance) ?? 0) + 1), new Map());
const noDetail = fresh.filter((p) => !p.summary).length;
console.log(
  `  · 关联度分布 高${relCount.get("高")} 中${relCount.get("中")} 低${relCount.get("低")}`,
);
console.log(`  · 无括注正文的新条目：${noDetail} 条（卡片只出标题，不编造正文）`);
console.log(
  `  · 每章条数（第 1–7 章）：${chapters
    .slice(0, 7)
    .map((c) => points.filter((p) => p.chapter === c.name).length)
    .join("/")}`,
);
if (oldHeadPoints.length) {
  console.log(`  · 旧第 1–7 章 → 新条目反查（${legacyCovered}/${oldHeadPoints.length}）：\n${legacyHow.join("\n")}`);
} else {
  console.log("  · 本次输入已是转换产物，旧第 1–7 章不在表里，沿用上一轮的 legacyIds");
}

/* 覆盖区间退化检查：这几条是文档里点名保语义的深链。 */
const chapterPagePairs = [];
for (const point of points) {
  for (const name of point.chapters ?? [point.chapter]) {
    const span = spanOf(name);
    if (!span) continue;
    for (const printed of point.pages ?? [point.page]) {
      if (printed >= span.from && printed <= span.to) {
        chapterPagePairs.push({ name, printed, id: point.id });
      }
    }
  }
}

function resolveLikeKnowledgeLinks(page) {
  const inChapter = chapterPagePairs.filter((pair) => {
    const span = spanOf(pair.name);
    return span && page >= span.from && page <= span.to;
  });
  if (inChapter.length === 0) return null;
  const covering = [...inChapter]
    .sort((a, b) => a.printed - b.printed || a.id - b.id)
    .reverse()
    .find((pair) => pair.printed <= page);
  return covering ?? inChapter.sort((a, b) => a.printed - b.printed)[0];
}

for (const [page, expectedId] of [[373, 219], [132, 14], [197, 81], [223, 173], [386, null]]) {
  const covering = resolveLikeKnowledgeLinks(page);
  const label = `kb://${page} → ${covering ? `#${covering.id}（${covering.name}）` : "null"}`;
  if (expectedId == null) check(label, Boolean(covering), "找不到覆盖条目");
  else
    check(
      `${label} 命中 #${expectedId}`,
      covering?.id === expectedId,
      covering ? `实际 #${covering.id}` : "无覆盖",
    );
}

/* ---------- 切片归属复核（镜像 src/lib/kb-images.ts 的 join） ---------- */

/* 这两处实现必须同步：脚本这份是防漂移的 tripwire，运行时那份是真正生效的索引。
   Workbuddy 会反复覆盖 kb-data.ts，靠这里把「UI 会不会缺图」变成一条能跑的命令。 */
const kbDataPath = path.join(root, "src", "data", "kb-data.ts");
const imagesDir = path.join(root, "public", "images", "kb");

function readKbImages() {
  if (!fs.existsSync(kbDataPath)) return [];
  return fs
    .readFileSync(kbDataPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("src:"))
    .map((line) => {
      const a = line.indexOf('"');
      const b = line.indexOf('"', a + 1);
      const pi = line.indexOf("page:");
      const pe = line.indexOf(",", pi);
      const t1 = line.indexOf('"', pe + 1);
      const t2 = line.lastIndexOf('"');
      return {
        src: line.slice(a + 1, b),
        page: Number(line.slice(pi + 5, pe).trim()),
        // 源文本里的转义反斜杠要一起抹掉，否则与运行时解析出的字符串不等价
        title: line.slice(t1 + 1, t2).replace(/\\/g, ""),
      };
    });
}

const TITLE_NOISE = /[\s　（）()·、，,；;：:／/—–\-*★“”"]+/g;
const normTitle = (text) => text.replace(TITLE_NOISE, "").toLowerCase();
const labelOf = (point) => normTitle(point.name || point.section || point.summary);

const images = readKbImages();
if (images.length > 0) {
  check("切片记录数 = 187", images.length === 187, `实际 ${images.length}`);

  const wrongPage = images.filter((image) => {
    const physical = Number(image.src.match(/-p(\d+)\.png$/)?.[1]);
    return !Number.isFinite(physical) || physical - pdfOffset !== image.page;
  });
  check(
    "每条 page 都等于文件名物理页 − 28",
    wrongPage.length === 0,
    wrongPage.slice(0, 4).map((i) => `${i.src}→${i.page}`).join(" "),
  );

  const files = fs.existsSync(imagesDir) ? new Set(fs.readdirSync(imagesDir)) : new Set();
  const missing = images.filter((image) => !files.has(image.src));
  const unregistered = [...files].filter((name) => !images.some((image) => image.src === name));
  check("每个 src 都有实体文件", missing.length === 0, missing.slice(0, 4).map((i) => i.src).join(" "));
  check("没有未登记的文件", unregistered.length === 0, unregistered.slice(0, 4).join(" "));

  const idsByPage = new Map();
  for (const point of points) {
    for (const page of point.pages ?? [point.page]) {
      const list = idsByPage.get(page);
      if (list) list.push(point.id);
      else idsByPage.set(page, [point.id]);
    }
  }

  const imagesByPage = new Map();
  for (const image of images) {
    const list = imagesByPage.get(image.page);
    if (list) list.push(image);
    else imagesByPage.set(image.page, [image]);
  }

  const pointById = (id) => points.find((point) => point.id === id);
  const byPoint = new Map();
  let titleDisambiguated = 0;
  let fellBack = 0;
  let homeless = 0;
  for (const [page, onPage] of imagesByPage) {
    const owners = idsByPage.get(page);
    if (!owners || owners.length === 0) {
      homeless += onPage.length;
      continue;
    }
    const served = new Set();
    for (const image of onPage) {
      const byTitle = owners.find(
        (id) => !served.has(id) && labelOf(pointById(id)) === normTitle(image.title ?? ""),
      );
      if (byTitle != null && owners.length > 1) titleDisambiguated += 1;
      const chosen = byTitle ?? owners.find((id) => !served.has(id));
      if (chosen == null) {
        fellBack += 1;
        continue;
      }
      served.add(chosen);
      const list = byPoint.get(chosen);
      if (list) list.push(image);
      else byPoint.set(chosen, [image]);
    }
  }

  const covered = fresh.filter((point) => byPoint.has(point.id));
  check("184 条新知识点每条至少 1 张切片", covered.length === fresh.length, `实际 ${covered.length}/${fresh.length}`);
  check("没有无主的切片", homeless === 0, `${homeless} 张找不到归属条目`);
  check("同页多条时全部靠标题消歧，没走到兜底", fellBack === 0, `兜底 ${fellBack} 次`);

  const multi = fresh
    .filter((point) => (byPoint.get(point.id)?.length ?? 0) > 1)
    .map((point) => point.id);
  check("多图条目恰为 #14 / #16 / #39", JSON.stringify(multi) === JSON.stringify([14, 16, 39]), JSON.stringify(multi));

  for (const [, , hostId] of EXPECTED_HOSTS) {
    const count = byPoint.get(hostId)?.length ?? 0;
    check(`概念宿主 #${hostId} 拿到切片`, count >= 1, `实际 ${count} 张`);
  }
  console.log(
    `  · 切片 ${images.length} 张 → 条目 ${byPoint.size} 个；共用页靠标题消歧 ${titleDisambiguated} 次；` +
      ` 合计 ${fresh.reduce((sum, p) => sum + (byPoint.get(p.id)?.length ?? 0), 0)} 张落在第 1–7 章`,
  );
} else {
  console.log("  · 没找到 src/data/kb-data.ts，跳过切片归属复核");
}

/* ---------- 写出 ---------- */

for (const chapter of chapters) {
  chapter.count = points.filter((p) => p.chapter === chapter.name).length;
}

const knowledgeBase = {
  title: existing.title,
  sourceTitle: "核心知识点清单·全量合并（第 1–3 批） + 深度学习-核心知识页码对照表",
  intro:
    `依据 Goodfellow、Bengio、Courville《深度学习》中文版整理，覆盖 20 章、${points.length} 个知识点。` +
    `第 1–7 章为 ${fresh.length} 条细粒度全量索引，第 8–20 章沿用旧版 ${tail.length} 条，待后续批次逐章替换。`,
  note: existing.note,
  pdfOffset,
  parts: existing.parts,
  chapters,
  points,
};

const header = `// Generated by scripts/build-kb-index.mjs — do not edit by hand.
// 第 1–7 章来自 知识库材料/核心知识点清单_全量合并.md（184 条），
// 第 8–20 章沿用 深度学习-核心知识页码对照表.xlsx 的旧 104 条（id 平移为 ${fresh.length + 1}–${points.length}）。
//
// 页码：本文件一律是**印刷页码**，物理 PDF 页 = 印刷页 + ${pdfOffset}。
// 清单里的 \`P.NNN\` 是物理页（_build_kb.py 用 doc[page_no - 1] 裁页），换算后才落到这里。
// pages / chapters 是数组：★ 合并行（SGD、反向传播、PCA、过拟合、正则化）跨批出现，
// 一条卡片同时属于两章、占两页；page/chapter 取首个，分组与筛选按首个走。
// legacyIds 是旧 169 条编号的反查表。question-index.ts 是冻结快照（资料库/ 已不存在，
// build-question-index.mjs 跑不起来），它的 target.pointId 仍是旧编号；
// KnowledgePanel 先按 id 查，查不到再按 legacyIds 查，都查不到才退到章锚点。
//
// 注意：下面这个 export 必须是文件里最后一个对象字面量，它后面不能再出现闭合大括号。
// scripts/build-case-library.mjs 与 scripts/build-question-index.mjs 都靠「找到 knowledgeBase
// 这个 export 之后的第一个开括号，再到全文件最后一个闭括号」切片后 JSON.parse。
// 所以这段头注释里绝不能提前写出那行 export 的原文，否则解析器会从这里开始切。

export type KnowledgeRelevance = "高" | "中" | "低";

export type KnowledgePoint = {
  id: number;
  part: string;
  chapter: string;
  chapterPages: string;
  section: string;
  summary: string;
  terms: string[];
  page: number;
  /** 卡片标题。第 1–7 章的新条目才有；旧条目回落到 section。 */
  name?: string;
  /** 该条目的全部印刷页（升序），首个等于 page。 */
  pages?: number[];
  /** 该条目涉及的全部章名，首个等于 chapter。 */
  chapters?: string[];
  relevance?: KnowledgeRelevance;
  /** 被本条目吸收的旧 169 条编号。 */
  legacyIds?: number[];
};

export type KnowledgeChapter = {
  name: string;
  part: string;
  pages: string;
  description: string;
  count: number;
};

export type KnowledgeBase = {
  title: string;
  sourceTitle: string;
  intro: string;
  note: string;
  pdfOffset: number;
  parts: string[];
  chapters: KnowledgeChapter[];
  points: KnowledgePoint[];
};

export const knowledgeBase: KnowledgeBase = `;

fs.writeFileSync(
  knowledgeBasePath,
  `${header}${JSON.stringify(knowledgeBase, null, 2)};\n`,
  "utf8",
);

/* 用两个 build 脚本完全相同的切片方式回读一遍，确保没把它们的解析器写崩。 */
const reread = fs.readFileSync(knowledgeBasePath, "utf8");
const marker = reread.indexOf("export const knowledgeBase");
const sliceFrom = reread.indexOf("{", reread.indexOf("=", marker));
let roundTripped = false;
try {
  const parsed = JSON.parse(reread.slice(sliceFrom, reread.lastIndexOf("}") + 1));
  roundTripped = parsed.points.length === points.length;
} catch {
  roundTripped = false;
}
check("产物能被 build-case-library.mjs 的切片方式 JSON.parse 回来", roundTripped);
check("文件末尾除对象字面量外没有多余的 }", reread.lastIndexOf("}") === reread.length - 3);

console.log(`\n写出 ${knowledgeBasePath} —— ${points.length} 条知识点`);
if (failures.length) {
  console.error(`\n${failures.length} 项自检未通过：\n  ${failures.join("\n  ")}`);
  process.exitCode = 1;
}
