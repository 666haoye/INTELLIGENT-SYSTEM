/* 核心概念层：10 个值得单独给一段手写深度解读并加描边强调的知识点，手工策展。
 *
 * 为什么不塞进 `src/data/kb-data.ts`：那个文件由 `知识库材料/_build_kb.py` 整体重写，
 * 手工映射放进去一次生成就没了。
 *
 * 这里**不再登记图片文件名**。上一轮只有 12 张切片、归属只能手写；现在 187 张覆盖了
 * 全部 184 条，归属由 `src/lib/kb-images.ts` 按「印刷页 + 标题」算出来。
 * 再留一份手写文件清单就是第二个权威：Workbuddy 下次重生成改了文件名，这 10 行不会报错，
 * 只会让概念卡静默失去图片，而其余 174 张卡照常带图 —— 最难发现的那种坏法。
 * 实测两种口径给这 10 条的结果逐一相同，所以删掉不改变任何表现。
 *
 * `pointIds` 填的是 `knowledge-base.ts` 里的条目 id（288 条表里的序号 1–184 段）。
 * 每张切片属于哪一条由 `scripts/build-kb-index.mjs` 按物理页反查并断言唯一：
 * 切片文件名里的 `pNNN` 是物理页，`kb-data.ts` 的 `page` 是印刷页（= 物理页 − 28），
 * 用印刷页 +28 回到物理页去撞清单的「物理页序号」，10 张切片各自命中且仅命中一行 ——
 * SGD 撞 [42,160]、反向传播撞 [44,203]，正好就是清单里那两条 ★ 跨批合并行。
 * 所以这里的数字不是猜的，是那张表跑出来的；改了清单重跑脚本，脚本报 FAIL 就是这里要跟着改的时候。
 */

export type KbConcept = {
  /** 概念的身份键，与各条切片文件名族一致（`kb-sgd-*`、`kb-dropout-*`） */
  kbId: string;
  /** 宿主卡「深度解读」段的小标题 */
  title: string;
  /** 叠在条目正文之上的手写深度解读 */
  summary: string;
  /** 认领这条概念的知识条目 id，当前每个概念恰好一个宿主 */
  pointIds: number[];
};

export const kbConcepts: KbConcept[] = [
  {
    kbId: "sgd",
    title: "随机梯度下降 (SGD)",
    summary:
      "每次只用一小批（mini-batch）样本来估计梯度并更新参数，用采样的噪声换取单步成本的骤降——这是深度网络能训得动的根本原因。批越小，梯度估计越不准，但单位算力见到的样本越多；因此实际训练靠学习率衰减与动量来压住这份噪声，而不是把批大小一路推到全量。",
    pointIds: [14],
  },
  {
    kbId: "backprop",
    title: "反向传播 (Backpropagation)",
    summary:
      "把复合函数的梯度按计算图自底向上复用，一次反向 pass 就算出损失对全部参数的导数，代价与前向传播同量级。它的复杂度只随参数个数线性增长，而不是随参数个数指数增长——正是这一点让上千层网络的训练从不可行变成常规操作。",
    pointIds: [16],
  },
  {
    kbId: "gradient-descent",
    title: "梯度下降 (Gradient Descent)",
    summary:
      "沿负梯度方向迭代更新参数以最小化目标函数的一阶方法。步长太小收敛慢、太大在极小值两侧震荡甚至发散；曲率差异悬殊时，固定步长会让迭代沿等高线的椭圆反复 zigzag。这正是动量法与自适应学习率要解决的问题。",
    pointIds: [67],
  },
  {
    kbId: "regularization",
    title: "正则化 (Regularization)",
    summary:
      "泛指一切用来降低**泛化误差**而非训练误差的策略，本质是偏差—方差权衡：主动引入一点偏差，换方差大幅下降。多数方法都能看成给模型加了某种先验约束，让它别把训练集里的采样噪声当成规律学进去。",
    pointIds: [81],
  },
  {
    kbId: "overfitting",
    title: "过拟合与欠拟合",
    summary:
      "欠拟合是模型容量不足以逼近真实函数；过拟合是模型把训练集的采样噪声也拟合了，于是训练误差一路走低而验证误差掉头上升。判断依据不是训练误差本身，而是训练误差与验证误差之间那条越拉越大的间隙——正则化的作用就是把模型从过拟合那一侧拉回匹配的那一侧。",
    pointIds: [78],
  },
  {
    kbId: "l2-penalty",
    title: "L2 权重衰减 (Weight Decay)",
    summary:
      "往目标里加 ‖w‖₂² 惩罚，等价于对权重取高斯先验的 MAP 估计。梯度更新里它表现为每步先把权重乘上一个略小于 1 的系数，故称权重衰减：偏好小幅、平缓的解。它还会把 Hessian 的特征值整体抬高，改善优化条件数，间接缓解梯度消失与病态曲率。",
    pointIds: [149],
  },
  {
    kbId: "l1-penalty",
    title: "L1 参数正则化",
    summary:
      "往目标里加 ‖w‖₁ 惩罚，对应拉普拉斯先验的 MAP。L1 的等值线在坐标轴上有尖角，最优解因此容易落在尖角上，也就是让一部分权重精确等于 0——得到稀疏解，顺带完成特征选择。这也是它与 L2 最直观的区别：L2 只把权重压小，L1 把权重压没。",
    pointIds: [154],
  },
  {
    kbId: "data-augmentation",
    title: "数据集增强 (Data Augmentation)",
    summary:
      "对训练样本施加人为已知的变换（平移、翻转、裁剪、旋转）来生成伪样本，等于直接告诉模型「这些变换不改变标签」。它不惩罚任何权重，而是改写训练分布本身，因此常是同等代价下最有效的一档正则化；代价是必须确知变换的语义不变性，错标一个不变性反而会引入偏差。",
    pointIds: [157],
  },
  {
    kbId: "early-stopping",
    title: "提前终止 (Early Stopping)",
    summary:
      "边训边在验证集上测误差，取它最低的那一刻的快照而不是最后一次迭代。实现上要保留历史最优副本、并容忍验证误差的短期抖动而非一抖就停。在二次近似下它与 L2 正则化等价——两者都是限制参数偏离初始化点太远，只是执行方式不同。",
    pointIds: [162],
  },
  {
    kbId: "dropout",
    title: "Dropout",
    summary:
      "训练时按概率 p 随机丢弃单元，等价于每步都在采样一个不同的子网络来训练，最终近似于对指数级多个共享权重的子网络做几何平均集成。它破坏的是单元之间靠共适应拟合噪声的路径。推理时必须换成不丢弃的全网络并按比例缩放，否则激活的期望尺度对不上。",
    pointIds: [173],
  },
];

/**
 * 索引条目 → 概念。first-wins：一个 pointId 只认第一个认领它的概念。
 * 当前 10 个概念的 pointIds 互不重复，保留这条规则是为了以后加概念时不至于静默双挂。
 */
export const CONCEPT_BY_POINT: ReadonlyMap<number, KbConcept> = (() => {
  const map = new Map<number, KbConcept>();
  for (const concept of kbConcepts) {
    for (const pointId of concept.pointIds) {
      if (!map.has(pointId)) map.set(pointId, concept);
    }
  }
  return map;
})();
