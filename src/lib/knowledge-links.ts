import { knowledgeBase, type KnowledgePoint } from "@/data/knowledge-base";
import { LAB_EXPERIMENTS, type LabExperiment } from "@/data/experiments";
import type { KnowledgeTarget } from "@/lib/question-search";

function sectionNumbers(text: string): string[] {
  return text.match(/[0-9]+\.[0-9]+/g) ?? [];
}

type ChapterSpan = { name: string; from: number; to: number };

const CHAPTER_SPANS: ChapterSpan[] = knowledgeBase.chapters
  .map((chapter) => {
    const matched = chapter.pages.match(/([0-9]+)\s*-\s*([0-9]+)/);
    return matched
      ? { name: chapter.name, from: Number(matched[1]), to: Number(matched[2]) }
      : null;
  })
  .filter((span): span is ChapterSpan => span !== null);

const POINTS_BY_CHAPTER = new Map<string, KnowledgePoint[]>();
for (const point of knowledgeBase.points) {
  const list = POINTS_BY_CHAPTER.get(point.chapter);
  if (list) list.push(point);
  else POINTS_BY_CHAPTER.set(point.chapter, [point]);
}
for (const list of POINTS_BY_CHAPTER.values()) {
  list.sort((a, b) => a.page - b.page || a.id - b.id);
}

/**
 * 印刷页码 → 知识库定位目标（供 kb:// 使用）。
 * 用「覆盖区间」而非「最近页」：p373 的最近页是 #101（p374，11.6 示例），语义是错的；
 * 覆盖区间给出 #100（p371，11.5 调试策略），正是 E13 对应的那条。
 */
export function resolvePageToKnowledgeTarget(
  page: number,
): KnowledgeTarget | null {
  if (!Number.isFinite(page)) return null;

  const span = CHAPTER_SPANS.find(
    (chapter) => page >= chapter.from && page <= chapter.to,
  );
  if (!span) return null;

  const points = POINTS_BY_CHAPTER.get(span.name) ?? [];
  if (points.length === 0) return { chapter: span.name };

  let covering: KnowledgePoint | null = null;
  for (const point of points) {
    if (point.page <= page) covering = point;
    else break;
  }

  const target = covering ?? points[0];
  return { chapter: span.name, pointId: target.id };
}

const EXPERIMENT_SECTIONS = LAB_EXPERIMENTS.map((experiment) => ({
  experiment,
  numbers: experiment.chapter.split("·").flatMap(sectionNumbers),
}));

function buildExperimentsByPoint(): Map<number, LabExperiment[]> {
  const map = new Map<number, LabExperiment[]>();
  for (const point of knowledgeBase.points) {
    const pointNumbers = sectionNumbers(point.section);
    if (pointNumbers.length === 0) continue;
    const hits = EXPERIMENT_SECTIONS.filter((entry) =>
      entry.numbers.some((number) => pointNumbers.includes(number)),
    ).map((entry) => entry.experiment);
    if (hits.length > 0) map.set(point.id, hits);
  }
  return map;
}

/**
 * 知识点 → 配套实验。按章节号匹配，比页码相等更准：
 * 169 条里恰好 10 条命中，且 E13(p373)/E33(p372) 没有任何同页知识点，只有章节号能对的上。
 */
export const EXPERIMENTS_BY_POINT: ReadonlyMap<number, LabExperiment[]> =
  buildExperimentsByPoint();
