/* 教材切片的类型契约与「知识点 → 切片」索引。
 *
 * 数据本体在 `src/data/kb-data.ts`（外部工具生成）。逻辑刻意放在这里，是因为生成器
 * 每次都会整体重写那个数据文件 —— 索引和取图规则写在里面就会一起丢。
 * 索引风格照 `src/lib/knowledge-links.ts`：模块级建一次 Map，运行时只查表。
 *
 * 这里是全仓库唯一同时看得见「Workbuddy 生成的图」和「脚本生成的索引」的地方，
 * 所以归属关系只能在这里算出来。
 */
import { kbImages } from "@/data/kb-data";
import { knowledgeBase, type KnowledgePoint } from "@/data/knowledge-base";

export type KbImage = {
  /** 文件名或站内相对路径，例如 "p038-fig.png" / "images/kb/p038-fig.png" */
  src: string;
  /** 原书印刷页码（与 KnowledgePoint.page 同一口径，不是 PDF 页码） */
  page: number;
  /** 切片标题，显示在 Tab 与放大层下方；缺省不显示 */
  title?: string;
  /** 无障碍替代文本；缺省由 title / 页码拼出 */
  alt?: string;
};

/** 切片统一放这里，导出与 dev 两种环境都能命中（见 scripts/export-single-html.mjs） */
const KB_DIR = "images/kb/";

/** 只写文件名就补目录前缀；已经带前缀或绝对 URL 的原样返回 */
export function kbImageSrc(src: string): string {
  if (/^([a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(src)) return src;
  return src.startsWith(KB_DIR) ? src : `${KB_DIR}${src}`;
}

export function kbImageAlt(image: KbImage): string {
  return image.alt ?? `《深度学习》印刷页 P.${image.page}${image.title ? `：${image.title}` : ""} 教材切片`;
}

const POINT_BY_ID = new Map<number, KnowledgePoint>(
  knowledgeBase.points.map((point) => [point.id, point]),
);

/* 清单写「提前终止(early stopping)」，切片标题写「提前终止 (Early Stopping)」，
   同一个概念两种写法 —— 比对前先抹掉空白与全半角标点。 */
const TITLE_NOISE =
  /[\s　（）()·、，,；;：:／/—–\-*★"“”]+/g;

const normalizeTitle = (text: string) => text.replace(TITLE_NOISE, "").toLowerCase();

const pointLabel = (point: KnowledgePoint) =>
  normalizeTitle(point.name || point.section || point.summary);

const pointPages = (point: KnowledgePoint) => point.pages ?? [point.page];

/**
 * 印刷页 → 知识点。用数组而不是单值：清单里有四个印刷页被两条知识点同时占用
 * （#43/#44 同页 49、#47/#48 同页 52、#50/#51 同页 82、#91/#92 同页 123），
 * 一页只留一个主人的话，另一条会整条没了图，而两张图会一起挂到同一条上。
 */
const IDS_BY_PAGE = new Map<number, number[]>();
for (const point of knowledgeBase.points) {
  for (const page of pointPages(point)) {
    const owners = IDS_BY_PAGE.get(page);
    if (owners) owners.push(point.id);
    else IDS_BY_PAGE.set(page, [point.id]);
  }
}

const IMAGES_BY_PAGE = new Map<number, KbImage[]>();
for (const image of kbImages) {
  if (!Number.isFinite(image.page) || !image.src) continue;
  const list = IMAGES_BY_PAGE.get(image.page);
  if (list) list.push(image);
  else IMAGES_BY_PAGE.set(image.page, [image]);
}

/**
 * 知识点 → 切片，按印刷页升序。
 *
 * 先按页找主人；同页有多条知识点时用标题认亲（实测 4 个共用页上的 8 张图全部认得出来）。
 * 标题也认不出的那张，退给该页还没拿到图的第一条 —— 宁可退一步，也不要让两张图挤到同一条、
 * 另一条空手。数据与索引任一边重新生成，这段都会自动跟上，不需要人工改文件名清单。
 */
const IMAGES_BY_POINT = new Map<number, KbImage[]>();
for (const [page, imagesOnPage] of IMAGES_BY_PAGE) {
  const owners = IDS_BY_PAGE.get(page);
  if (!owners || owners.length === 0) continue;

  const served = new Set<number>();
  for (const image of imagesOnPage) {
    const byTitle = owners.find(
      (id) => !served.has(id) && pointLabel(POINT_BY_ID.get(id)!) === normalizeTitle(image.title ?? ""),
    );
    const ownerId = byTitle ?? owners.find((id) => !served.has(id)) ?? owners[0];
    served.add(ownerId);

    const list = IMAGES_BY_POINT.get(ownerId);
    if (list) list.push(image);
    else IMAGES_BY_POINT.set(ownerId, [image]);
  }
}
for (const list of IMAGES_BY_POINT.values()) {
  list.sort((a, b) => a.page - b.page);
}

/** 空数组要用同一个实例：调用方会把结果当 prop 交给 memo 过的组件。 */
const NO_IMAGES: KbImage[] = [];

/**
 * 取某条知识点的切片。
 *
 * 返回的是索引里那个数组本身，不是副本 —— `KbImageTabs` 用 `useMemo([failed, images])`
 * 过滤 404，`PointCard` 又被 `React.memo` 包住，两边都靠引用相等来避免无谓重算。
 * 每次 new 一个数组会让这两处优化同时失效。
 */
export function kbImagesForPoint(pointId: number): KbImage[] {
  return IMAGES_BY_POINT.get(pointId) ?? NO_IMAGES;
}
