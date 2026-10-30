import { knowledgeBase, type KnowledgePoint } from "@/data/knowledge-base";
import { LAB_EXPERIMENTS, type LabExperiment } from "@/data/experiments";
import { bookLabMapRows } from "@/data/book-lab-map";
import { caseLibrary, type FormalCase } from "@/data/case-library";
import type { KnowledgeTarget } from "@/lib/question-search";

type ChapterSpan = { name: string; from: number; to: number };

const CHAPTER_SPANS: ChapterSpan[] = knowledgeBase.chapters
  .map((chapter) => {
    const matched = chapter.pages.match(/([0-9]+)\s*-\s*([0-9]+)/);
    return matched
      ? { name: chapter.name, from: Number(matched[1]), to: Number(matched[2]) }
      : null;
  })
  .filter((span): span is ChapterSpan => span !== null);

const pointPages = (point: KnowledgePoint): number[] => point.pages ?? [point.page];
const pointChapters = (point: KnowledgePoint): string[] =>
  point.chapters ?? [point.chapter];

/**
 * 页码 → 知识库定位目标（供 kb:// 使用）。
 *
 * 索引键是 (章, 页) 而不是章：★ 合并行一条占两页、跨两章（SGD 是印刷 14 与 132，
 * 分别属第一、第五章）。只按 `point.chapter` 分组、只按 `point.page` 排序的话，
 * 132 页根本查不到 SGD 这一条，`kb://132` 会落到隔壁卡片上。
 * 一对 (章, 页) 只有在页落在该章 pages 区间内时才登记，避免「第五章的 14 页」这种组合污染覆盖区间。
 */
type ChapterEntry = { point: KnowledgePoint; page: number };

const ENTRIES_BY_CHAPTER = new Map<string, ChapterEntry[]>();

for (const point of knowledgeBase.points) {
  for (const name of pointChapters(point)) {
    const span = CHAPTER_SPANS.find((chapter) => chapter.name === name);
    if (!span) continue;
    for (const page of pointPages(point)) {
      if (page < span.from || page > span.to) continue;
      const list = ENTRIES_BY_CHAPTER.get(name);
      const entry = { point, page };
      if (list) list.push(entry);
      else ENTRIES_BY_CHAPTER.set(name, [entry]);
    }
  }
}

for (const list of ENTRIES_BY_CHAPTER.values()) {
  list.sort((a, b) => a.page - b.page || a.point.id - b.point.id);
}

/**
 * 用「覆盖区间」而非「最近页」：p373 的最近页是 p374 那条，语义是错的；
 * 覆盖区间给出 11.5 调试策略，正是 E13 对应的那条。
 *
 * 返回的 `chapter` 是**卡片所在分组**（point.chapter），不是命中的那一章：
 * `kb://132` 通过第五章的 (章, 页) 对命中 SGD 那条，但它渲染在第一章的组里，
 * 面板只有按第一章筛选，`#kb-point-14` 这个锚点才存在。
 */
export function resolvePageToKnowledgeTarget(
  page: number,
): KnowledgeTarget | null {
  if (!Number.isFinite(page)) return null;

  const span = CHAPTER_SPANS.find(
    (chapter) => page >= chapter.from && page <= chapter.to,
  );
  if (!span) return null;

  const entries = ENTRIES_BY_CHAPTER.get(span.name) ?? [];
  if (entries.length === 0) return { chapter: span.name };

  let covering: ChapterEntry | null = null;
  for (const entry of entries) {
    if (entry.page <= page) covering = entry;
    else break;
  }

  const target = covering ?? entries[0];
  return { chapter: target.point.chapter, pointId: target.point.id };
}

/** 旧 169 条编号 → 本表条目。由 `knowledge-base.ts` 每条上的 `legacyIds` 反向建表。 */
const POINT_BY_LEGACY_ID = new Map(
  knowledgeBase.points.flatMap((point) =>
    (point.legacyIds ?? []).map(
      (legacyId) => [legacyId, point] as const,
    ),
  ),
);

/**
 * 旧编号定位 → 本表编号。翻译只发生在 question-index 的出口，全应用之后只有一套编号。
 *
 * 为什么必须有这一步：`question-index.ts` 是**冻结快照**（`资料库/` 已不存在，
 * scripts/build-question-index.mjs 跑不起来），它的 169 个 point unit 仍带旧 pointId；
 * 而本表的 id 已经换成 1–184 + 185–288。旧 #43「5.9 随机梯度下降」如果原样传下去，
 * 会滚到新 #43「频率派概率 vs 贝叶斯概率」—— 看着像成功，其实指错了卡，
 * 比落空更难发现。
 *
 * 也没有可靠的启发式可反推：旧 #2 和新 #2 都在第一章，章名一致、页码只差两页，
 * 任何"页码就近"的猜测都仍可能认错。只有**来源知道自己用的是哪套编号**，
 * 所以翻译必须写在 question-index 的出口，而不是让消费方去猜。
 *
 * 一旦 `资料库/知识库/` 补齐、question-index 用新表重生成，这个函数就该整个删掉。
 */
export function toCurrentTarget(target: KnowledgeTarget): KnowledgeTarget {
  if (target.pointId == null) return target;

  const point = POINT_BY_LEGACY_ID.get(target.pointId);
  if (!point) return { chapter: target.chapter, query: target.query };

  return { ...target, chapter: point.chapter, pointId: point.id };
}

/**
 * 知识条目 → 卡片底部的跳转按钮。
 *
 * 唯一来源是 `教材实验案例映射表.md`（经 scripts/build-book-lab-map.mjs 转成
 * `src/data/book-lab-map.ts`）。这里只负责把每行的印刷页落到条目上：
 * 走 `resolvePageToKnowledgeTarget` 的**覆盖区间**语义，和 `kb://` 深链完全同一套 ——
 * 尾部第 8–20 章是粗粒度条目，MD 里 P.372/373/386/391/404/406 这几页在表里根本不存在，
 * 要求页码精确相等会让 E13/E33 各少一个入口、C01/C05/C06/C07 四个案例彻底挂不上。
 *
 * 这一整块原来是按章节号正则去撞的（`EXPERIMENTS_BY_POINT` + 四条手写覆盖）。
 * 人工核对的映射表出来后那套猜测就该退休 —— 同一件事不能有两个权威，
 * 否则下次两张表给出不同答案时，没人说得清 UI 该听谁的。
 */
export type LabLinks = {
  experiments: LabExperiment[];
  cases: FormalCase[];
  /** 编号 → 「关联原因简述」，渲染成按钮的 title。同一编号多行时取第一行。 */
  reasons: Map<string, string>;
};

const EXPERIMENT_BY_CODE = new Map(
  LAB_EXPERIMENTS.map((experiment) => [experiment.code, experiment]),
);

const CASE_BY_CODE = new Map(
  caseLibrary.formalCases.map((item) => [item.code, item]),
);

function buildLabByPoint(): Map<number, LabLinks> {
  const map = new Map<number, LabLinks>();

  for (const row of bookLabMapRows) {
    const pointId = resolvePageToKnowledgeTarget(row.printedPage)?.pointId;
    if (pointId == null) continue;

    const links = map.get(pointId) ?? {
      experiments: [],
      cases: [],
      reasons: new Map<string, string>(),
    };

    for (const code of row.expCodes) {
      const experiment = EXPERIMENT_BY_CODE.get(code);
      if (!experiment || links.experiments.some((item) => item.code === code)) continue;
      links.experiments.push(experiment);
      if (!links.reasons.has(code)) links.reasons.set(code, row.reason);
    }
    for (const code of row.caseCodes) {
      const item = CASE_BY_CODE.get(code);
      /* 表里的编号悬空时宁可不渲染按钮，也不给卡片留一个点开是空的入口。 */
      if (!item || links.cases.some((seen) => seen.code === code)) continue;
      links.cases.push(item);
      if (!links.reasons.has(code)) links.reasons.set(code, row.reason);
    }

    map.set(pointId, links);
  }

  return map;
}

export const LAB_BY_POINT: ReadonlyMap<number, LabLinks> = buildLabByPoint();
