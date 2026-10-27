import {
  questionIndex,
  type SearchUnit,
  type StarterQuestion,
} from "@/data/question-index";

export type KnowledgeTarget = {
  chapter: string;
  pointId?: number;
  query?: string;
};

export type SearchIntent =
  | "definition"
  | "mechanism"
  | "comparison"
  | "troubleshooting"
  | "formula"
  | "practical"
  | "general";

export type SearchHit = SearchUnit & {
  score: number;
  matchedTerms: string[];
};

export type SearchResponse = {
  query: string;
  intent: SearchIntent;
  intentLabel: string;
  answer: SearchHit | null;
  hits: SearchHit[];
  suggestions: StarterQuestion[];
  noMatch: boolean;
};

export const INTENT_LABELS: Record<SearchIntent, string> = {
  definition: "定义解释",
  mechanism: "原理机制",
  comparison: "对比辨析",
  troubleshooting: "训练排障",
  formula: "公式推导",
  practical: "实践方法",
  general: "相关知识",
};

const STOP_PHRASES = [
  "在哪里",
  "在哪一页",
  "哪一页",
  "哪一章",
  "第几页",
  "多少页",
  "有什么区别",
  "有什么不同",
  "有什么关系",
  "请问",
  "告诉我",
  "解释一下",
  "介绍一下",
  "什么是",
  "是什么",
  "为什么",
  "为何",
  "怎么",
  "如何",
  "怎样",
  "有哪些",
  "有什么",
  "哪种",
  "哪一个",
  "哪个",
  "之间",
  "的区别",
  "区别",
  "不同",
  "对比",
  "比较",
  "分别",
  "可以",
  "应该",
  "需要",
  "一下",
  "讲讲",
  "说说",
  "帮我",
  "我想",
  "的",
  "吗",
  "呢",
  "了",
  "和",
  "与",
  "及",
  "或",
  "我",
  "想",
  "把",
].sort((a, b) => b.length - a.length);

const CJK_RUN = /[\u3400-\u9fff]+/g;
const WORD_RUN = /[a-z0-9]+/g;

const dictionary = buildDictionary();
const dictionarySet = new Set(dictionary);
const maxDictionaryLength = dictionary.reduce(
  (max, term) => Math.max(max, term.length),
  2,
);

type IndexedUnit = {
  unit: SearchUnit;
  tokenWeights: Map<string, number>;
  tokenSet: Set<string>;
  titleTokens: Set<string>;
  termTokens: Set<string>;
  docLength: number;
  normalizedTitle: string;
  normalizedSection: string;
};

type Engine = {
  docs: IndexedUnit[];
  idf: Map<string, number>;
  averageLength: number;
};

let engineCache: Engine | null = null;

function normalizeText(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\u3400-\u9fff\u4e00-\u9fffa-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompact(input: string): string {
  return normalizeText(input).replace(/\s+/g, "");
}

function buildDictionary(): string[] {
  const terms = new Set<string>();

  const add = (value: string) => {
    const normalized = normalizeCompact(value);
    if (normalized.length >= 2) terms.add(normalized);
  };

  for (const unit of questionIndex.units) {
    for (const term of unit.terms) add(term);
    add(unit.chapter);
    add(unit.section);
  }
  for (const term of questionIndex.glossary) add(term.term);
  for (const group of questionIndex.synonyms) {
    for (const alias of group) add(alias);
  }

  return Array.from(terms).sort((a, b) => b.length - a.length);
}

function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const tokens: string[] = [];

  /* Character bigrams keep unknown Chinese wording searchable. */
  for (const run of normalized.match(CJK_RUN) ?? []) {
    if (run.length === 1) {
      tokens.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i += 1) {
      tokens.push(run.slice(i, i + 2));
    }
  }

  /* Latin/number terms. */
  for (const word of normalized.match(WORD_RUN) ?? []) {
    tokens.push(word);
  }

  /* Longest dictionary term at every position catches multi-character concepts. */
  for (let i = 0; i < normalized.length; ) {
    if (normalized[i] === " ") {
      i += 1;
      continue;
    }
    let matched = false;
    const maxLength = Math.min(maxDictionaryLength, normalized.length - i);
    for (let length = maxLength; length >= 2; length -= 1) {
      const candidate = normalized.slice(i, i + length);
      if (dictionarySet.has(candidate)) {
        tokens.push(candidate);
        i += length;
        matched = true;
        break;
      }
    }
    if (!matched) i += 1;
  }

  return tokens;
}

function stripQuestionWords(normalized: string): string {
  let result = normalized;
  for (const phrase of STOP_PHRASES) {
    if (result.includes(phrase)) {
      result = result.split(phrase).join(" ");
    }
  }
  return result.replace(/\s+/g, " ").trim();
}

function detectIntent(query: string): SearchIntent {
  if (/公式|推导|怎么算|如何计算|求导|计算式/.test(query)) return "formula";
  if (/区别|不同|对比|比较|\bvs\b|哪个好|哪个更/.test(query)) {
    return "comparison";
  }
  if (
    /不下降|不收敛|震荡|爆炸|消失|过拟合|欠拟合|调试|排查|失效|训练不动|怎么办|怎么解决|调参/.test(
      query,
    )
  ) {
    return "troubleshooting";
  }
  if (/是什么|什么是|定义|含义|概念|指什么/.test(query)) return "definition";
  if (/为什么|原因|原理|如何工作|怎么工作|原理是什么/.test(query)) {
    return "mechanism";
  }
  if (/怎么|如何|步骤|用什么|选择|实践|调优/.test(query)) return "practical";
  return "general";
}

function addWeighted(
  target: Map<string, number>,
  tokens: string[],
  weight: number,
) {
  for (const token of tokens) {
    target.set(token, (target.get(token) ?? 0) + weight);
  }
}

function buildEngine(): Engine {
  const docs: IndexedUnit[] = questionIndex.units.map((unit) => {
    const tokenWeights = new Map<string, number>();
    const titleTokens = tokenize(unit.title);
    const termTokens = tokenize(unit.terms.join(" "));

    addWeighted(tokenWeights, titleTokens, 3);
    addWeighted(tokenWeights, termTokens, 2.8);
    addWeighted(tokenWeights, tokenize(unit.text), 1.25);
    addWeighted(tokenWeights, tokenize(unit.chapter), 0.45);

    let docLength = 0;
    for (const weight of tokenWeights.values()) docLength += weight;

    return {
      unit,
      tokenWeights,
      tokenSet: new Set(tokenWeights.keys()),
      titleTokens: new Set(titleTokens),
      termTokens: new Set(termTokens),
      docLength,
      normalizedTitle: normalizeCompact(unit.title),
      normalizedSection: normalizeCompact(unit.section),
    };
  });

  const idf = new Map<string, number>();
  const documentFrequency = new Map<string, number>();
  for (const doc of docs) {
    for (const token of doc.tokenSet) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  for (const [token, df] of documentFrequency) {
    idf.set(
      token,
      Math.log(1 + (docs.length - df + 0.5) / (df + 0.5)),
    );
  }

  const averageLength =
    docs.reduce((sum, doc) => sum + doc.docLength, 0) / Math.max(1, docs.length);

  return { docs, idf, averageLength };
}

function getEngine(): Engine {
  if (!engineCache) engineCache = buildEngine();
  return engineCache;
}

function expandWithSynonyms(
  content: string,
  queryTokens: string[],
): string[] {
  const flat = normalizeCompact(content);
  const expanded = [...queryTokens];

  for (const group of questionIndex.synonyms) {
    const hit = group.some((alias) => {
      const a = normalizeCompact(alias);
      return a.length >= 2 && flat.includes(a);
    });
    if (!hit) continue;
    for (const alias of group) {
      expanded.push(...tokenize(alias));
    }
  }

  return expanded;
}

function suggestQuestions(
  query: string,
  topHit: SearchHit | null,
): StarterQuestion[] {
  const context = normalizeText(
    `${query} ${topHit ? `${topHit.title} ${topHit.text}` : ""}`,
  );
  const queryTokens = new Set(tokenize(stripQuestionWords(context)));

  const ranked = questionIndex.starterQuestions
    .map((question) => {
      const overlap = tokenize(normalizeText(question.text)).reduce(
        (score, token) => score + (queryTokens.has(token) ? 1 : 0),
        0,
      );
      return { question, overlap };
    })
    .sort((a, b) => b.overlap - a.overlap)
    .map((item) => item.question);

  const distinct = ranked.filter(
    (question) => normalizeCompact(question.text) !== normalizeCompact(query),
  );

  return distinct.slice(0, 3);
}

export function searchKnowledge(input: string): SearchResponse {
  const query = input.trim();
  const normalized = normalizeText(query);
  const content = stripQuestionWords(normalized);
  const intent = detectIntent(normalized);

  if (!content) {
    return {
      query,
      intent,
      intentLabel: INTENT_LABELS[intent],
      answer: null,
      hits: [],
      suggestions: questionIndex.starterQuestions.slice(0, 3),
      noMatch: true,
    };
  }

  const engine = getEngine();
  const queryTokens = expandWithSynonyms(content, tokenize(content));
  if (!queryTokens.length) {
    return {
      query,
      intent,
      intentLabel: INTENT_LABELS[intent],
      answer: null,
      hits: [],
      suggestions: suggestQuestions(query, null),
      noMatch: true,
    };
  }

  const queryCounts = new Map<string, number>();
  for (const token of queryTokens) {
    queryCounts.set(token, (queryCounts.get(token) ?? 0) + 1);
  }

  const coreTokens = new Set(
    queryTokens.filter(
      (token) => dictionarySet.has(token) || /^[a-z0-9]{2,}$/.test(token),
    ),
  );

  const k1 = 1.25;
  const b = 0.72;
  const flatQuery = normalizeCompact(content);
  const topCoreToken = [...coreTokens].sort(
    (a, b) => (engine.idf.get(b) ?? 0) - (engine.idf.get(a) ?? 0),
  )[0];
  const topCoreIdf = topCoreToken
    ? engine.idf.get(topCoreToken) ?? 0
    : 0;

  const scored: SearchHit[] = [];

  for (const doc of engine.docs) {
    let score = 0;

    for (const [token, queryCount] of queryCounts) {
      const tokenIdf = engine.idf.get(token);
      const tf = doc.tokenWeights.get(token);
      if (!tokenIdf || !tf) continue;
      const denominator =
        tf + k1 * (1 - b + (b * doc.docLength) / engine.averageLength);
      score += tokenIdf * queryCount * ((tf * (k1 + 1)) / denominator);
    }

    if (score <= 0) continue;

    const matchedTerms: string[] = [];
    let termBoost = 0;
    for (const term of doc.unit.terms) {
      const normalizedTerm = normalizeCompact(term);
      if (
        normalizedTerm.length >= 2 &&
        (flatQuery.includes(normalizedTerm) ||
          normalizedTerm.includes(flatQuery))
      ) {
        termBoost += 1.4;
        matchedTerms.push(term);
      }
    }
    score += Math.min(5, termBoost);

    if (
      flatQuery.length >= 3 &&
      (flatQuery.includes(doc.normalizedTitle) ||
        doc.normalizedTitle.includes(flatQuery))
    ) {
      score += 4;
    }
    if (
      flatQuery.length >= 4 &&
      doc.normalizedSection &&
      (flatQuery.includes(doc.normalizedSection) ||
        doc.normalizedSection.includes(flatQuery))
    ) {
      score += 2;
    }

    let coveredCore = 0;
    let titleCoreIdf = 0;
    let termCoreIdf = 0;
    for (const token of coreTokens) {
      if (doc.tokenSet.has(token)) coveredCore += 1;
      const tokenIdf = engine.idf.get(token) ?? 0;
      if (doc.titleTokens.has(token)) titleCoreIdf += tokenIdf;
      if (doc.termTokens.has(token)) termCoreIdf += tokenIdf;
    }
    if (coreTokens.size > 0) {
      const coverage = coveredCore / coreTokens.size;
      score *= 0.85 + coverage * (intent === "comparison" ? 0.65 : 0.3);
    }
    /* Specific named concepts in titles/terms should beat a general symptom match. */
    score += titleCoreIdf * 2.4 + termCoreIdf * 0.9;
    if (topCoreToken && doc.tokenSet.has(topCoreToken)) {
      score += topCoreIdf * 3;
    }

    if (intent === "troubleshooting") {
      if (doc.unit.kind === "chapter" && doc.unit.section.includes("易错点")) {
        score += 2.2;
      }
      if (/正则化|优化|实践方法论/.test(doc.unit.chapter)) score += 0.6;
    } else if (intent === "formula" && doc.unit.kind === "formula") {
      score += 2.4;
    } else if (intent === "definition" && doc.unit.kind === "point") {
      score += 0.35;
    } else if (
      intent === "practical" &&
      /实践|优化|正则化/.test(doc.unit.chapter)
    ) {
      score += 0.45;
    }

    scored.push({
      ...doc.unit,
      score,
      matchedTerms: [...new Set(matchedTerms)].slice(0, 6),
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const priority = { point: 3, formula: 2, chapter: 1 };
    return priority[b.kind] - priority[a.kind];
  });

  const strong = scored.filter((hit) => hit.score >= 2);
  const noMatch = strong.length === 0;
  const hits = noMatch ? [] : strong.slice(0, 6);
  const answer = hits[0] ?? null;

  return {
    query,
    intent,
    intentLabel: INTENT_LABELS[intent],
    answer,
    hits,
    suggestions: suggestQuestions(query, answer),
    noMatch,
  };
}

export { questionIndex };
export type { StarterQuestion };
