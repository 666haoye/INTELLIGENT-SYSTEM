export type LabExperiment = {
  /** 小写编号，如 "e04"，对应 experiments/exp-e04.html */
  id: string;
  code: string;
  title: string;
  chapter: string;
  page: string;
  /** true = 教材明文要求，false = 配套设计 */
  required: boolean;
  purpose: string;
};

export const LAB_EXPERIMENTS: LabExperiment[] = [
  {
    id: "e04",
    code: "E04",
    title: "多项式阶数看过拟合与欠拟合",
    chapter: "5.2 容量、过拟合和欠拟合",
    page: "97",
    required: false,
    purpose: "找到测试误差由降转升的拐点——那就是过拟合发生的位置。",
  },
  {
    id: "e08",
    code: "E08",
    title: "PCA 降维与重建",
    chapter: "2.12 实例：主成分分析",
    page: "42",
    required: false,
    purpose: "看投影—重建的误差线，以及保留方差比例随 k 如何变化。",
  },
  {
    id: "e11",
    code: "E11",
    title: "感知机为什么学不会异或",
    chapter: "6.1 实例：学习XOR",
    page: "148",
    required: false,
    purpose: "看训练准确率卡在 75%、损失不再下降——这是「必须加隐藏层」的动机。",
  },
  {
    id: "e12",
    code: "E12",
    title: "两层 MLP 解决 XOR",
    chapter: "6.1 实例：学习XOR",
    page: "148",
    required: false,
    purpose: "看决策区域从一条直线变成能拐弯的两块，准确率冲到 100%。",
  },
  {
    id: "e13",
    code: "E13",
    title: "反向传播梯度与有限差分对拍",
    chapter: "11.5 调试策略",
    page: "373",
    required: true,
    purpose: "对拍误差小于 1e-6 才算实现正确；注入 bug 后误差立刻爆掉。",
  },
  {
    id: "e21",
    code: "E21",
    title: "Dropout 开关对比",
    chapter: "7.12 Dropout",
    page: "222",
    required: false,
    purpose: "开 Dropout 后训练准确率变低、但训练与测试的 gap 收窄。",
  },
  {
    id: "e22",
    code: "E22",
    title: "学习率敏感性扫描",
    chapter: "8.3 基本算法",
    page: "251",
    required: false,
    purpose: "拿到那条典型的 U 形曲线——太小走不动，太大直接发散。",
  },
  {
    id: "e27",
    code: "E27",
    title: "手工卷积核 → 可学习卷积核",
    chapter: "9.1 卷积运算 · 9.2 动机",
    page: "282",
    required: false,
    purpose: "先看懂卷积在提取什么，再让网络自己学出同样的东西。",
  },
  {
    id: "e32",
    code: "E32",
    title: "长期依赖：RNN 的梯度通路 vs LSTM 的细胞状态",
    chapter: "10.7 长期依赖的挑战 · 10.10 门控RNN",
    page: "343",
    required: false,
    purpose: "看两条曲线：RNN 的对数梯度范数一路俯冲，LSTM 基本水平。",
  },
  {
    id: "e33",
    code: "E33",
    title: "过拟合一个极小数据集（调试必做）",
    chapter: "11.5 调试策略",
    page: "372",
    required: true,
    purpose: "训不到 100% 就说明代码有 bug——打开注入的 bug 复现这个结论。",
  },
];

export function experimentHref(id: string): string {
  return `experiments/exp-${id}.html`;
}
