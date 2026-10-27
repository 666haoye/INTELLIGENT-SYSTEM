export type NodeId = "knowledge" | "problem" | "cases" | "sandbox";
export type WingSide = "left" | "right";
export type ModuleMode = "knowledge" | "problem" | "cases" | "sandbox" | "pending";

export type ModuleNode = {
  id: NodeId;
  title: string;
  eyebrow: string;
  index: string;
  side: WingSide;
  /** Fraction of the 1440 × 900 SVG stage. */
  x: number;
  y: number;
  mode: ModuleMode;
  blurb: string;
};

export const MODULE_NODES: ModuleNode[] = [
  {
    id: "problem",
    title: "问题导向",
    eyebrow: "NEURAL NODE 02 · PROBLEM",
    index: "02",
    side: "left",
    x: 566 / 1440,
    y: 365 / 900,
    mode: "problem",
    blurb: "从真实问题出发，串联知识点、方法与解决路径。",
  },
  {
    id: "knowledge",
    title: "知识库",
    eyebrow: "NEURAL NODE 01 · KNOWLEDGE",
    index: "01",
    side: "right",
    x: 874 / 1440,
    y: 365 / 900,
    mode: "knowledge",
    blurb: "按章节、主题与印刷页码检索 169 条核心知识。",
  },
  {
    id: "cases",
    title: "案例库",
    eyebrow: "NEURAL NODE 03 · CASES",
    index: "03",
    side: "left",
    x: 566 / 1440,
    y: 620 / 900,
    mode: "cases",
    blurb: "10 个正式案例与 8 个教学微案例，按领域、章节与关键词检索。",
  },
  {
    id: "sandbox",
    title: "实验沙盒",
    eyebrow: "NEURAL NODE 04 · SANDBOX",
    index: "04",
    side: "right",
    x: 874 / 1440,
    y: 620 / 900,
    mode: "sandbox",
    blurb: "10 个可在浏览器中运行的数字实验：过拟合、PCA、XOR、梯度对拍……",
  },
];

export const NODE_BY_ID = Object.fromEntries(
  MODULE_NODES.map((node) => [node.id, node]),
) as Record<NodeId, ModuleNode>;
