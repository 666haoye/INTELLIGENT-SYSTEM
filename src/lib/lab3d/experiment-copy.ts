/* 3D 实验页的文案来源。
 *
 * 标题 / 章节 / 页码 / purpose / form 全部来自 `src/data/experiments.ts`（唯一权威），
 * 只有 conclusion 与 acceptance 是静态 Canvas-2D 页 `public/experiments/exp-eXX.js` 里才有的，
 * 这里补上并注明出处 —— 否则三个场景各抄一遍，改一次就漂一次。
 */
import { LAB_EXPERIMENTS } from "@/data/experiments";

type ExtraCopy = {
  /** 与静态页 LAB.shell 的 conclusion 逐字一致 */
  conclusion: string;
  /** 与静态页的 acceptance 逐字一致：3D 版也按同一条验收线设计 */
  acceptance: string;
};

const EXTRA: Record<string, ExtraCopy> = {
  E04: {
    conclusion:
      "阶数低时两条误差都高（欠拟合）；阶数拉高后训练误差一路降到近 0，测试误差反而回升——中间的谷底就是最优容量。",
    acceptance:
      "deg=3 的测试 RMSE（0.158）应小于 deg=12（0.524）；deg 增大时训练 RMSE 单调下降（0.115 → 0.019）",
  },
  E08: {
    conclusion:
      "k=0 时全部塌到中心；k=1 时误差线全垂直于第一主成分；k=2 时误差为 0。相关越强，丢掉第二主成分的代价越小。",
    acceptance: "k=2 时重建误差 < 1e-9 且保留方差 = 100%；k=0 时重建 RMSE 显著更大（约 1.97）。",
  },
  E12: {
    conclusion:
      "与 e11 同一份数据，只多一层隐藏单元，准确率从封顶 75% 变成 100%。隐藏层把 XOR 变成了线性可分——这就是「学表示」。",
    acceptance: "XOR + 2 层隐藏，训练 1500 步后准确率 ≥ 99.9%，loss 降到 1e-3 量级。",
  },
  E22: {
    conclusion:
      "把条件数调大（碗更扁），可用学习率的范围明显变窄——这正是 4.2 节「病态条件」在优化里的直接后果。",
    acceptance: "能找到最优学习率（约 6.7e-2）；lr = 1e-4 时损失很大（约 6.5e+1）；lr = 10 时发散",
  },
  E27: {
    conclusion:
      "手工核能立刻看懂「卷积在提取什么」。切到随机初始化再运行，核会自己收敛成类似 Sobel 的权重——这就是「卷积核是可学习的特征提取器」。",
    acceptance:
      "随机初始化训练 400 步后，MSE 从约 1.21e-1 降到 < 1e-3（应达 8e-4 量级），学到的核与 Sobel 的余弦相似度 > 0.9（应达 0.98）",
  },
};

export type LabCopy = {
  code: string;
  title: string;
  source: string;
  purpose: string;
  form: string;
  conclusion: string;
  acceptance: string;
};

export function labCopy(code: string): LabCopy {
  const experiment = LAB_EXPERIMENTS.find((item) => item.code === code);
  const extra = EXTRA[code];
  if (!experiment || !extra) {
    throw new Error(`labCopy: 没有 ${code} 的文案（experiments.ts 或 EXTRA 缺一边）`);
  }
  return {
    code,
    title: experiment.title,
    source: `${experiment.chapter} · 印刷页 P.${experiment.page} · ${
      experiment.required ? "教材必做" : "配套设计"
    }`,
    purpose: experiment.purpose,
    form: experiment.form,
    conclusion: extra.conclusion,
    acceptance: extra.acceptance,
  };
}
