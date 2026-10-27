/* 生成物：由 scripts/build-case-library.mjs 从 资料库/案例库/ 的 Markdown 生成。
 * 不要手改本文件 —— 改源 MD 后执行 npm run qa:cases 重新生成。 */

export type CaseSource = "flower" | "tensorflow";
export type CaseTrack = "research" | "practice";

export type ScenarioOption = { key: string; text: string };

export type FormalCase = {
  id: string;
  code: string;
  title: string;
  /** 细类，如「工程实践 / 反向传播」；筛选按 " / " 前缀归并成大类 */
  domain: string;
  track: CaseTrack;
  /** 字符串：实战案例的年份带括注，如「2020（教材实战）」 */
  year: string;
  keywords: string[];
  source: CaseSource;
  /** 印刷页码；源文件里不是纯数字的（如 C15）为 null */
  page: number | null;
  /** 配套实验编号；可能指向尚未开发的实验，渲染前必须校验 */
  experimentCode: string | null;
  chapter: string;
  options: ScenarioOption[];
  correctKey: string;
  problem: string;
  method: string;
  result: string;
  lesson: string;
};

export type MicroCase = {
  id: string;
  concept: string;
  example: string;
  chapter: string;
  link: string;
};

export type CaseLibrary = {
  title: string;
  kicker: string;
  source: string;
  note: string;
  pageOffset: number;
  /** 按 " / " 前缀归并后的大类，用于筛选下拉 */
  domains: string[];
  formalCases: FormalCase[];
  microCases: MicroCase[];
};

export const caseLibrary: CaseLibrary = {
  "title": "深度学习案例库",
  "kicker": "先推演，再看当年真实的选择与结果",
  "source": "《深度学习》（Goodfellow / Bengio / Courville）中文版 与 《TensorFlow 深度学习》（龙良曲）",
  "note": "C01–C10 页码出自花书，可跳转知识库；C11–C23 页码出自《TensorFlow 深度学习》，本知识库未收录。印刷页码 + 28 = PDF 阅读器页码。",
  "pageOffset": 28,
  "domains": [
    "计算机视觉",
    "语音",
    "自然语言处理",
    "工业",
    "多模态",
    "科学计算",
    "工程实践"
  ],
  "formalCases": [
    {
      "id": "c01",
      "code": "C01",
      "title": "AlexNet 赢得 ILSVRC 2012 图像分类",
      "domain": "计算机视觉",
      "track": "research",
      "year": "2012",
      "keywords": [
        "CNN",
        "深度学习",
        "ImageNet",
        "ILSVRC"
      ],
      "source": "flower",
      "page": 386,
      "experimentCode": "E27",
      "chapter": "第十二章 应用",
      "options": [
        {
          "key": "A",
          "text": "继续使用传统的手工特征提取 + 浅层分类模型"
        },
        {
          "key": "B",
          "text": "使用深度卷积神经网络（CNN）并配合 GPU 训练"
        },
        {
          "key": "C",
          "text": "直接把全连接网络层数堆高"
        }
      ],
      "correctKey": "B",
      "problem": "在高分辨率自然图像上识别 1000 类对象，此前最先进方法性能长期受限",
      "method": "使用深度卷积网络（ReLU 激活、双 GPU 训练），预处理仅对每个像素减去训练样本均值",
      "result": "把 ILSVRC 前 5 错误率从 26.1% 降到 15.3%；此后深度卷积网络连年夺冠，最低降到 3.6%",
      "lesson": "足够深的卷积网络配足够大的数据，可以一举超过手工特征时代的最好成绩"
    },
    {
      "id": "c02",
      "code": "C02",
      "title": "生成式对抗网络生成图像",
      "domain": "计算机视觉",
      "track": "research",
      "year": "2014",
      "keywords": [
        "GAN",
        "生成式模型",
        "对抗训练",
        "图像生成",
        "博弈"
      ],
      "source": "flower",
      "page": 597,
      "experimentCode": "E40",
      "chapter": "第二十章 深度生成模型",
      "options": [
        {
          "key": "A",
          "text": "继续使用高斯混合等显式密度模型去拟合数据分布"
        },
        {
          "key": "B",
          "text": "让生成器与判别器零和博弈，直接生成样本"
        },
        {
          "key": "C",
          "text": "直接最大化数据的对数似然"
        }
      ],
      "correctKey": "B",
      "problem": "生成模型很难同时做到\"可直接采样\"，又\"不需要近似推断和配分函数\"",
      "method": "让生成器与判别器进行零和博弈，生成器直接从噪声出样本，判别器判断样本是真是假",
      "result": "理论收敛时生成样本与真实数据不可区分，判别器处处输出 1/2；不需要近似推断，也不需要配分函数梯度；但实践中的鞍点问题使训练可能不收敛",
      "lesson": "用博弈代替似然，绕开了配分函数这座大山，代价是把优化问题变成了不稳定的对抗过程"
    },
    {
      "id": "c03",
      "code": "C03",
      "title": "RBM 无监督预训练改进 TIMIT 音素识别",
      "domain": "语音",
      "track": "research",
      "year": "2012",
      "keywords": [
        "RBM",
        "无监督预训练",
        "TIMIT",
        "音素识别"
      ],
      "source": "flower",
      "page": 390,
      "experimentCode": null,
      "chapter": "第十二章 应用",
      "options": [
        {
          "key": "A",
          "text": "继续用 GMM-HMM 作为主力的声学建模方式"
        },
        {
          "key": "B",
          "text": "用受限玻尔兹曼机逐层无监督预训练来初始化深层前馈网络"
        },
        {
          "key": "C",
          "text": "直接随机初始化深层网络并用反向传播训练"
        }
      ],
      "correctKey": "B",
      "problem": "从 20 世纪 80 年代到 2010 年代初，GMM-HMM 语音识别系统性能长期停滞",
      "method": "用受限玻尔兹曼机逐层无监督预训练来初始化深层前馈网络，代替高斯混合模型把声学特征映射到音素或子音素状态",
      "result": "TIMIT 数据集上音素级错误率从约 26% 降到 20.7%",
      "lesson": "数据量小的时候，无监督预训练是深度网络能不能训起来的关键；但数据足够大之后它就不再是必需品"
    },
    {
      "id": "c04",
      "code": "C04",
      "title": "深度 LSTM 循环网络端到端语音识别",
      "domain": "语音",
      "track": "research",
      "year": "2013",
      "keywords": [
        "LSTM",
        "端到端",
        "CTC",
        "循环神经网络",
        "TIMIT"
      ],
      "source": "flower",
      "page": 392,
      "experimentCode": "E32",
      "chapter": "第十二章 应用",
      "options": [
        {
          "key": "A",
          "text": "继续用 HMM 串联多个手工组件的传统流水线"
        },
        {
          "key": "B",
          "text": "用深度 LSTM 循环网络 + CTC 框架端到端建模，完全抛开 HMM"
        },
        {
          "key": "C",
          "text": "仅加宽普通 MLP 来建模声学特征"
        }
      ],
      "correctKey": "B",
      "problem": "传统语音识别依赖 HMM 串联多个手工组件，流程复杂且难以整体优化",
      "method": "用深度长短期记忆循环网络做帧到音素排列的 MAP 推断，配合 CTC 框架，完全抛开 HMM",
      "result": "把 TIMIT 数据集上音素错误率的纪录降到 17.7% 的新低",
      "lesson": "端到端建模能用一个大网络替换整条手工流水线，这是后续所有序列任务的通用范式"
    },
    {
      "id": "c05",
      "code": "C05",
      "title": "深度学习推动工业级语音识别落地",
      "domain": "语音",
      "track": "research",
      "year": "2012",
      "keywords": [
        "语音识别",
        "DNN",
        "词错误率",
        "工业落地"
      ],
      "source": "flower",
      "page": 391,
      "experimentCode": null,
      "chapter": "第十二章 应用",
      "options": [
        {
          "key": "A",
          "text": "继续沿用已停滞十年的 GMM-HMM 方案"
        },
        {
          "key": "B",
          "text": "工业界与学术界合作，用深度神经网络替换 GMM 并引入 ReLU、Dropout"
        },
        {
          "key": "C",
          "text": "仅依靠堆算力，不改动模型结构"
        }
      ],
      "correctKey": "B",
      "problem": "语音识别精度从 2000 年前后起停滞约十年，工业界缺乏换技术的动力",
      "method": "工业语音研究组与学术界合作，用深度神经网络替换 GMM 来建模声学特征到音素的映射，并引入 ReLU 与 Dropout",
      "result": "以词错误率衡量，语音识别性能提升约 30%，属史无前例；约两年内工业界多数语音产品都换成了深度神经网络",
      "lesson": "一项技术真正落地，靠的是与工业界的数据、工程和产品资源结合，而不只是论文上的精度"
    },
    {
      "id": "c06",
      "code": "C06",
      "title": "神经语言模型与词嵌入",
      "domain": "自然语言处理",
      "track": "research",
      "year": "2003",
      "keywords": [
        "词嵌入",
        "word embedding",
        "分布式表示",
        "n-gram",
        "维数灾难"
      ],
      "source": "flower",
      "page": 406,
      "experimentCode": null,
      "chapter": "第十二章 应用",
      "options": [
        {
          "key": "A",
          "text": "继续用 n-gram 语言模型，靠平滑处理稀疏"
        },
        {
          "key": "B",
          "text": "用神经网络为每个词学习低维分布式向量表示"
        },
        {
          "key": "C",
          "text": "仅用 one-hot 编码，不做降维"
        }
      ],
      "correctKey": "B",
      "problem": "词表巨大且稀疏，n-gram 语言模型难以泛化，维数灾难严重",
      "method": "用神经网络为每个词学习低维分布式向量表示，让语义和用法相近的词在嵌入空间中彼此靠近",
      "result": "把词表示从 one-hot 空间（任意两词欧氏距离都是根号 2）压到低维嵌入空间，语义相近的词自然邻近；采样方法训练大词表时，输出层梯度代价从与词表规模成正比降到与负样本数成正比",
      "lesson": "好的表示带来泛化能力，嵌入空间里的邻近就是模型泛化的来源"
    },
    {
      "id": "c07",
      "code": "C07",
      "title": "注意力机制用于神经机器翻译",
      "domain": "自然语言处理",
      "track": "research",
      "year": "2015",
      "keywords": [
        "注意力机制",
        "Attention",
        "神经机器翻译",
        "编码器-解码器"
      ],
      "source": "flower",
      "page": 404,
      "experimentCode": null,
      "chapter": "第十二章 应用",
      "options": [
        {
          "key": "A",
          "text": "继续用\"把整句源语言压成固定长度向量\"的编码器-解码器"
        },
        {
          "key": "B",
          "text": "让解码器每步对编码器输出做可微的加权平均（注意力）"
        },
        {
          "key": "C",
          "text": "仅加长固定向量的维度"
        }
      ],
      "correctKey": "B",
      "problem": "编码器-解码器必须把整句源语言压成一个固定长度向量，长句信息严重丢失",
      "method": "让解码器在每个时间步对编码器输出的特征向量做加权平均，权重由模型自己产生的相关性得分过 softmax 得到",
      "result": "首次实现每个输出时刻聚焦源句的不同部分；注意力权重落在 0 到 1 之间且完全可微，能用梯度下降训练（花书未给出 BLEU 数值）",
      "lesson": "把不可导的硬索引换成可微的加权平均，是让注意力真正能被训练的关键一步"
    },
    {
      "id": "c08",
      "code": "C08",
      "title": "街景多位数字转录系统",
      "domain": "工业",
      "track": "research",
      "year": "2014",
      "keywords": [
        "门牌识别",
        "端到端系统设计",
        "覆盖率",
        "置信度拒绝"
      ],
      "source": "flower",
      "page": 374,
      "experimentCode": "E34",
      "chapter": "第十一章 实践方法论",
      "options": [
        {
          "key": "A",
          "text": "先定指标再动手，并可视化置信度最高的错误来改进"
        },
        {
          "key": "B",
          "text": "一上来就换更大更深的模型"
        },
        {
          "key": "C",
          "text": "仅用准确率作为唯一指标"
        }
      ],
      "correctKey": "A",
      "problem": "把街景照片里的门牌号准确转成文字，用于在地图上定位地址",
      "method": "以带 ReLU 的卷积网络为基准，用多个 softmax 单元输出固定长度字符序列，并给出整串序列的对数似然以支持拒绝判断",
      "result": "准确率目标设为人类水平的 98%；覆盖率从低于 90% 提升到超出 95% 的目标，其中仅把裁剪区域加宽一项改动就使覆盖提高 10 个百分点",
      "lesson": "先定清楚性能度量再动手，并且可视化置信度最高的错误，常常比换模型更有效"
    },
    {
      "id": "c09",
      "code": "C09",
      "title": "图像描述生成（输出整串字符）",
      "domain": "多模态",
      "track": "research",
      "year": "2014",
      "keywords": [
        "图像描述",
        "看图说话",
        "序列到序列",
        "多模态"
      ],
      "source": "flower",
      "page": 22,
      "experimentCode": null,
      "chapter": "第一章 引言",
      "options": [
        {
          "key": "A",
          "text": "继续只做单对象分类"
        },
        {
          "key": "B",
          "text": "用神经网络直接从图像学习输出描述整张图的字符序列"
        },
        {
          "key": "C",
          "text": "对每个可能的句子单独标注后再训练"
        }
      ],
      "correctKey": "B",
      "problem": "此前模型只能识别图中单个对象，无法直接产出描述整张图的句子",
      "method": "用神经网络直接从输入图像学习输出描述图像的整个字符序列",
      "result": "证明了不需要对序列中每个元素单独标注也能学出整序列输出，打破了此前必须有元素级标注的成见（花书未给出具体评测数值）",
      "lesson": "端到端序列输出能力，是深度学习从分类跨向生成的标志"
    },
    {
      "id": "c10",
      "code": "C10",
      "title": "深度学习预测分子相互作用辅助药物设计",
      "domain": "科学计算",
      "track": "research",
      "year": "2014",
      "keywords": [
        "药物设计",
        "分子相互作用",
        "AI制药",
        "科学发现"
      ],
      "source": "flower",
      "page": 24,
      "experimentCode": null,
      "chapter": "第一章 引言",
      "options": [
        {
          "key": "A",
          "text": "继续依赖成本高、周期长的湿实验来筛选分子相互作用"
        },
        {
          "key": "B",
          "text": "用深度学习模型处理海量数据，对分子相互作用作有效预测"
        },
        {
          "key": "C",
          "text": "仅依靠专家经验与规则"
        }
      ],
      "correctKey": "B",
      "problem": "新药研发中预测分子之间如何相互作用成本高、周期长",
      "method": "用深度学习模型处理海量数据，对分子相互作用作有效预测",
      "result": "花书原文只给定性结论：已成功用于帮助制药公司设计新药物，并用于搜索亚原子粒子、解析构建人脑三维图的显微镜图像；未给出精度数字",
      "lesson": "深度学习的价值不止于感知任务，它同样能加速基础科学发现"
    },
    {
      "id": "c11",
      "code": "C11",
      "title": "2.3 线性模型实战（玩具数据拟合 y=1.477x+0.089）",
      "domain": "工程实践 / 回归",
      "track": "practice",
      "year": "2020（教材实战）",
      "keywords": [
        "线性回归",
        "梯度下降",
        "单神经元",
        "玩具样例"
      ],
      "source": "tensorflow",
      "page": 38,
      "experimentCode": null,
      "chapter": "《TensorFlow 深度学习》§2.3",
      "options": [
        {
          "key": "A",
          "text": "直接套用闭式解（正规方程）求参数"
        },
        {
          "key": "B",
          "text": "从已知真实模型 y=1.477x+0.089 采样并加高斯噪声，用梯度下降训练单输入神经元"
        },
        {
          "key": "C",
          "text": "用决策树拟合"
        }
      ],
      "correctKey": "B",
      "problem": "如何用梯度下降算法把单输入神经元线性模型训起来，并直观看到网络能从带噪样本恢复真实参数",
      "method": "从指定的真实模型 w=1.477, b=0.089 采样多组数据，给观测值叠加均值 0、标准差 0.01 的高斯误差，再手动实现梯度下降更新 w、b",
      "result": "通过不断迭代，模型参数逐步逼近真实值 w=1.477、b=0.089（以原书训练曲线为准）",
      "lesson": "最直观地体会\"观测样本带噪声时，梯度下降仍能收敛到真实分布参数\"，是后续所有回归/分类网络训练的起点"
    },
    {
      "id": "c12",
      "code": "C12",
      "title": "4.10 三层神经网络前向传播实战",
      "domain": "工程实践 / 张量编程",
      "track": "practice",
      "year": "2020（教材实战）",
      "keywords": [
        "前向传播",
        "张量",
        "ReLU",
        "MNIST"
      ],
      "source": "tensorflow",
      "page": 87,
      "experimentCode": null,
      "chapter": "《TensorFlow 深度学习》§4.10",
      "options": [
        {
          "key": "A",
          "text": "只做单矩阵乘法，不用非线性激活"
        },
        {
          "key": "B",
          "text": "用张量拼接三层全连接（784→256→128→10）并逐层加 ReLU，跑通 MNIST 前向计算"
        },
        {
          "key": "C",
          "text": "用纯 Python 循环逐元素计算"
        }
      ],
      "correctKey": "B",
      "problem": "把已学的张量创建、索引、维度变换、逐元素运算串起来，完成一个三层神经网络的前向计算",
      "method": "输入节点 784、第一层 256、第二层 128、第三层 10，按 out=ReLU(ReLU(ReLU(X@W1+b1)@W2+b2)@W3+b3) 逐层矩阵乘法并加偏置、ReLU",
      "result": "在 MNIST 手写数字图片集上跑通三层网络前向传播，输出 10 类概率（不在此步训练，仅前向计算）",
      "lesson": "张量的广播与矩阵乘法是后续所有网络实现的基础，先用 NumPy/Tensor 把前向算清楚，再接反向传播"
    },
    {
      "id": "c13",
      "code": "C13",
      "title": "5.8 MNIST 分类测试实战（三层网络）",
      "domain": "工程实践 / 分类",
      "track": "practice",
      "year": "2020（教材实战）",
      "keywords": [
        "MNIST",
        "分类",
        "前向传播",
        "准确率统计"
      ],
      "source": "tensorflow",
      "page": 111,
      "experimentCode": null,
      "chapter": "《TensorFlow 深度学习》§5.8",
      "options": [
        {
          "key": "A",
          "text": "只实现前向传播，不做训练与评估"
        },
        {
          "key": "B",
          "text": "完成分类逻辑，每 100 step 打印误差，训练 20 个 Epoch 后在测试集评估"
        },
        {
          "key": "C",
          "text": "用全部数据一次性计算，不迭代"
        }
      ],
      "correctKey": "B",
      "problem": "在 4.10 的前向传播基础上，补全分类任务的训练逻辑与评估逻辑，并监控训练进度",
      "method": "加载 MNIST 数据集与标签，间隔数个 step 打印误差；固定训练 20 个 Epoch，预测正确的数量除以总测试数量算准确率",
      "result": "通过简单的 3 层神经网络，训练固定 20 个 Epoch 后，在测试集上获得 **87.25%** 的准确率；若用更复杂网络、数据增强、精调超参可更高（具体见原书图 5.7/5.8 曲线）",
      "lesson": "简单三层全连接已在 MNIST 取得不错基准，但要突破须上卷积、数据增强与超参调优"
    },
    {
      "id": "c14",
      "code": "C14",
      "title": "6.8 汽车油耗（MPG）预测实战",
      "domain": "工程实践 / 回归",
      "track": "practice",
      "year": "2020（教材实战）",
      "keywords": [
        "Auto MPG",
        "回归",
        "全连接网络",
        "数值标准化"
      ],
      "source": "tensorflow",
      "page": 134,
      "experimentCode": null,
      "chapter": "《TensorFlow 深度学习》§6.8",
      "options": [
        {
          "key": "A",
          "text": "直接把原始数值灌进网络，不标准化"
        },
        {
          "key": "B",
          "text": "用全连接网络预测 MPG，对特征做标准化，按 7:3 切分训练/测试"
        },
        {
          "key": "C",
          "text": "只用气缸数一个特征拟合"
        }
      ],
      "correctKey": "B",
      "problem": "用全连接网络模型完成汽车效能指标 MPG（每加仑燃油英里数）的预测",
      "method": "采用 Auto MPG 数据集（气缸数、重量、马力等数值字段 + 产地类别 1/2/3），对连续特征做标准化，按 7:3 切分训练集与测试集（共 392 行，训练 314、测试 78）",
      "result": "在标准化后的训练集上构建数据集对象并完成回归训练（回归误差指标以原书训练曲线为准）",
      "lesson": "数值型表格回归要先做标准化，并按比例切分训练/测试，否则量纲差异会让梯度训练极不稳定"
    },
    {
      "id": "c15",
      "code": "C15",
      "title": "7.2.3 导数求解实战（自动求导演示）",
      "domain": "工程实践 / 自动求导",
      "track": "practice",
      "year": "2020（教材实战）",
      "keywords": [
        "自动求导",
        "梯度",
        "TensorFlow.GradientTape"
      ],
      "source": "tensorflow",
      "page": null,
      "experimentCode": null,
      "chapter": "《TensorFlow 深度学习》§7.2.3",
      "options": [
        {
          "key": "A",
          "text": "对 L=x²+b² 等简单函数手推偏导并手动验证"
        },
        {
          "key": "B",
          "text": "直接相信框架给出的梯度"
        },
        {
          "key": "C",
          "text": "用有限差分近似所有梯度"
        }
      ],
      "correctKey": "A",
      "problem": "理解自动求导机制，验证框架计算出的梯度与手推偏导数一致",
      "method": "对目标函数 L=x²+b²、L=e^x+e^y 等用 GradientTape 求偏导，再与手推结果 ∂L/∂x=2x、∂L/∂b=2b 等对照",
      "result": "框架自动求得的偏导与手推解析解一致，确认自动求导链路可信",
      "lesson": "先从小函数验证自动求导，再放心用于深层网络，是排查梯度 bug 的第一道保险"
    },
    {
      "id": "c16",
      "code": "C16",
      "title": "7.8 Himmelblau 函数优化实战",
      "domain": "工程实践 / 优化",
      "track": "practice",
      "year": "2020（教材实战）",
      "keywords": [
        "Himmelblau",
        "梯度下降",
        "优化算法",
        "局部极小"
      ],
      "source": "tensorflow",
      "page": 157,
      "experimentCode": null,
      "chapter": "《TensorFlow 深度学习》§7.8",
      "options": [
        {
          "key": "A",
          "text": "只用一个固定初始点做梯度下降"
        },
        {
          "key": "B",
          "text": "选不同初始状态做梯度下降，观察收敛到不同极小值"
        },
        {
          "key": "C",
          "text": "用解析法直接求全局最小值"
        }
      ],
      "correctKey": "B",
      "problem": "Himmelblau 函数是测试优化算法的经典样例，含两个自变量，有多个局部极小，用来展示初始状态对梯度下降的影响",
      "method": "实现 f(x,y)=(x²+y−11)²+(x+y²−7)²，从多个不同初始点出发做梯度下降",
      "result": "不同初始状态会收敛到不同极小值（详见原书表 7.1），直观解释\"初始状态对梯度下降的影响\"",
      "lesson": "非凸函数存在多个极小，优化结果强依赖初值；这正是对比散度、动量、学习率调度等技巧要解决的问题"
    },
    {
      "id": "c17",
      "code": "C17",
      "title": "7.9 反向传播算法实战（NumPy 手动实现）",
      "domain": "工程实践 / 反向传播",
      "track": "practice",
      "year": "2020（教材实战）",
      "keywords": [
        "反向传播",
        "手动梯度",
        "全连接",
        "Sigmoid+MSE"
      ],
      "source": "tensorflow",
      "page": 159,
      "experimentCode": null,
      "chapter": "《TensorFlow 深度学习》§7.9",
      "options": [
        {
          "key": "A",
          "text": "直接用 TensorFlow 自动求导，不亲手推导"
        },
        {
          "key": "B",
          "text": "用无自动求导的 NumPy 实现多层全连接网络，手动推导并逐层更新梯度"
        },
        {
          "key": "C",
          "text": "只对输出层手算梯度"
        }
      ],
      "correctKey": "B",
      "problem": "利用第 7 章推导的多层全连接网络梯度公式，直接用手动循环计算每层梯度并按梯度下降更新参数",
      "method": "选无自动求导的 NumPy、手动计算梯度、手动更新网络参数；约束为仅 Sigmoid 激活 + 均方误差损失的多层全连接网络",
      "result": "按 7:3 切分 2000 个样本点（训练 1400、测试 600），训练 1000 个 Epoch 后，在测试集 600 个样本上得到 **97.67%** 的准确率",
      "lesson": "亲手实现一次反向传播，才能真懂\"梯度如何从输出层一路回传\"，也是后续用框架自动求导时的对照基准"
    },
    {
      "id": "c18",
      "code": "C18",
      "title": "8.6.5 准确率统计实战（Accuracy 测量器）",
      "domain": "工程实践 / 评估指标",
      "track": "practice",
      "year": "2020（教材实战）",
      "keywords": [
        "metrics.Accuracy",
        "准确率",
        "Keras 高层接口"
      ],
      "source": "tensorflow",
      "page": 180,
      "experimentCode": null,
      "chapter": "《TensorFlow 深度学习》§8.6.5",
      "options": [
        {
          "key": "A",
          "text": "手数预测正确的样本个数"
        },
        {
          "key": "B",
          "text": "用 metrics.Accuracy() 测量器在每次前向计算后记录训练准确率"
        },
        {
          "key": "C",
          "text": "仅看 loss，不看准确率"
        }
      ],
      "correctKey": "B",
      "problem": "按照测量工具的使用方法，利用准确率测量器统计训练过程中的准确率",
      "method": "新建准确率测量器 acc_meter = metrics.Accuracy()，每次前向完成后调用 update_state(预测值, 真实值)",
      "result": "能自动累计并输出训练/测试的准确率，免去手动统计正确数量",
      "lesson": "框架提供的指标测量器可透明地累计 batch 统计量，是监控训练进度的标准做法"
    },
    {
      "id": "c19",
      "code": "C19",
      "title": "9.8 过拟合与欠拟合实战（月牙数据集）",
      "domain": "工程实践 / 正则化",
      "track": "practice",
      "year": "2020（教材实战）",
      "keywords": [
        "过拟合",
        "欠拟合",
        "make_moons",
        "Dropout/正则化"
      ],
      "source": "tensorflow",
      "page": 204,
      "experimentCode": null,
      "chapter": "《TensorFlow 深度学习》§9.8",
      "options": [
        {
          "key": "A",
          "text": "只用一个线性模型看效果"
        },
        {
          "key": "B",
          "text": "基于月牙形状二分类数据集，对比过拟合模型与欠拟合模型，并叠加各种防过拟合措施"
        },
        {
          "key": "C",
          "text": "直接把模型做得很深很宽"
        }
      ],
      "correctKey": "B",
      "problem": "此前大量使用月牙形状二分类数据集演示各种防过拟合措施，本实战基于该数据集做完整的过拟合/欠拟合对照",
      "method": "用 scikit-learn 的 make_moons 生成任意数量训练样本（特征长度 2、标签 0/1），构建网络并分别演示容量过小（欠拟合）与容量过大不防过拟合（过拟合）的情形",
      "result": "通过对照直观看到训练误差持续下降、测试误差先降后升的过拟合拐点（具体曲线以原书图为准）",
      "lesson": "模型容量与正则化的权衡是泛化能力的核心，月牙数据集是讲解过拟合最直观的玩具"
    },
    {
      "id": "c20",
      "code": "C20",
      "title": "10.4 LeNet-5 手写数字识别实战",
      "domain": "工程实践 / 计算机视觉",
      "track": "practice",
      "year": "2020（教材实战）",
      "keywords": [
        "LeNet-5",
        "CNN",
        "MNIST",
        "卷积+下采样"
      ],
      "source": "tensorflow",
      "page": 229,
      "experimentCode": null,
      "chapter": "《TensorFlow 深度学习》§10.4",
      "options": [
        {
          "key": "A",
          "text": "继续用三层全连接网络识别手写数字"
        },
        {
          "key": "B",
          "text": "用 LeNet-5（卷积→下采样→卷积→下采样→全连接）识别 MNIST 手写数字"
        },
        {
          "key": "C",
          "text": "用纯手工卷积核，不训练"
        }
      ],
      "correctKey": "B",
      "problem": "20 世纪 90 年代 LeCun 等人提出用于手写数字/字符识别的 LeNet-5，使 CNN 成功商用（邮政编码、支票号码），本实战复现它",
      "method": "网络接受 32×32 输入，经卷积层得 [b,28,28,6]，下采样到 [b,14,14,6]，再卷积得 [b,10,10,16]，下采样到 [b,5,5,16]，展平为 [b,400] 后接 120、84 两个全连接层输出",
      "result": "在 MNIST 手写数字图片数据集（6 万训练 / 1 万测试）上完成训练与测试（准确率以原书曲线为准）",
      "lesson": "CNN 的\"卷积+下采样\"比全连接更省参数、更利平移不变性，是图像识别走向实用的起点"
    },
    {
      "id": "c21",
      "code": "C21",
      "title": "10.10 CIFAR10 与 VGG13 实战",
      "domain": "工程实践 / 计算机视觉",
      "track": "practice",
      "year": "2020（教材实战）",
      "keywords": [
        "CIFAR10",
        "VGG13",
        "CNN",
        "彩色图像分类"
      ],
      "source": "tensorflow",
      "page": 248,
      "experimentCode": null,
      "chapter": "《TensorFlow 深度学习》§10.10",
      "options": [
        {
          "key": "A",
          "text": "继续只用灰度的 MNIST 训练卷积网络"
        },
        {
          "key": "B",
          "text": "换用 10 类彩色小图 CIFAR10，用 13 层 VGG 网络分类"
        },
        {
          "key": "C",
          "text": "仅用全连接处理 32×32×3 原图"
        }
      ],
      "correctKey": "B",
      "problem": "MNIST 太简单且只有灰度，不适合为 RGB 三通道设计的网络，本实战改用经典彩色分类数据集 CIFAR10",
      "method": "CIFAR10 由加拿大 CIFAR 发布，含飞机/汽车/鸟/猫等 10 类 32×32 彩色图，每类 6000 张，共 6 万（5 万训练 / 1 万测试）；用 VGG13 网络训练与测试",
      "result": "在 CIFAR10 上完成 VGG13 的训练与测试，并与后续 ResNet18 做性能比较（准确率/误差曲线以原书图 10.65 等为准）",
      "lesson": "从灰度 MNIST 到 RGB CIFAR10，网络要加深加宽，数据增强与正则化也变得更重要"
    },
    {
      "id": "c22",
      "code": "C22",
      "title": "10.14 CIFAR10 与 ResNet18 实战",
      "domain": "工程实践 / 计算机视觉",
      "track": "practice",
      "year": "2020（教材实战）",
      "keywords": [
        "ResNet18",
        "残差连接",
        "CIFAR10",
        "深度网络"
      ],
      "source": "tensorflow",
      "page": 266,
      "experimentCode": null,
      "chapter": "《TensorFlow 深度学习》§10.14",
      "options": [
        {
          "key": "A",
          "text": "把 VGG 继续堆到 18 层以上"
        },
        {
          "key": "B",
          "text": "用带 Skip Connection 的 18 层残差网络 ResNet18（输入调整为 32×32，输出 10）训练 CIFAR10"
        },
        {
          "key": "C",
          "text": "只用浅层网络，避免退化问题"
        }
      ],
      "correctKey": "B",
      "problem": "实现 18 层深度残差网络 ResNet18 并在 CIFAR10 上训练，与 13 层普通网络 VGG13 做简单性能比较",
      "method": "把标准 ResNet18（接受 224×224）调整为接受 32×32 输入、输出维度 10；实现残差模块 BasicBlock（中间两个卷积层 + Skip Connection 的 1×1 卷积）",
      "result": "在 CIFAR10 上训练并与 VGG13 对比；残差结构通过堆叠残差模块达到较深层数、缓解退化（准确率以原书图 10.68 等曲线为准）",
      "lesson": "残差连接让超深网络也能稳定训练，是突破\"网络越深越难训\"的关键结构性创新"
    },
    {
      "id": "c23",
      "code": "C23",
      "title": "11.5 RNN 情感分类问题实战（IMDB）",
      "domain": "工程实践 / 自然语言处理",
      "track": "practice",
      "year": "2020（教材实战）",
      "keywords": [
        "RNN",
        "情感分类",
        "IMDB",
        "Keras"
      ],
      "source": "tensorflow",
      "page": 284,
      "experimentCode": null,
      "chapter": "《TensorFlow 深度学习》§11.5",
      "options": [
        {
          "key": "A",
          "text": "用 Bag-of-Words + 线性分类器做情感判断"
        },
        {
          "key": "B",
          "text": "用两层基础 RNN 提取序列语义，取末态向量接全连接做二分类"
        },
        {
          "key": "C",
          "text": "仅用单个 LSTM 层"
        }
      ],
      "correctKey": "B",
      "problem": "用基础的 RNN 网络挑战情感分类问题，从句子序列中提取语义特征并判断积极/消极",
      "method": "RNN 共两层循环提取序列特征，取第二层 RNN 最后一时刻状态向量 h² 作为句子全局语义表示，送入全连接分类网络得积极情感概率 P∈[0,1]；用 Keras 的 Compile & Fit 训练，优化器 Adam（lr=0.001），损失用二分类交叉熵，指标用准确率",
      "result": "固定训练 20 个 Epoch 后，在测试集上获得 **80.1%** 的准确率",
      "lesson": "RNN 能天然处理变长文本序列，但其训练并不稳定、深度不能随意加深，这正是后续 LSTM/GRU 与注意力要解决的问题"
    }
  ],
  "microCases": [
    {
      "id": "n01",
      "concept": "过拟合",
      "example": "用 10 层网络去拟合只有 20 个样本的二分类任务，训练集准确率 100% 但测试集只有 60%，这就是过拟合。",
      "chapter": "第 7 章 正则化（5.2 节亦有定义）",
      "link": "t03"
    },
    {
      "id": "n02",
      "concept": "批标准化",
      "example": "批大小设为 1 或用长短不一的句子训练时 BatchNorm 几乎失效，这时换成 LayerNorm 才稳。",
      "chapter": "第 8 章 8.7（LayerNorm 花书未覆盖，原始文献 Ba et al. 2016）",
      "link": "t07"
    },
    {
      "id": "n03",
      "concept": "Dropout",
      "example": "想防止单元之间互相依赖、逼网络学冗余特征，用 Dropout；只想限制权重大小、让解更平滑，用权重衰减，两者可以同时开。",
      "chapter": "第 7 章 7.1 / 7.12",
      "link": "t03"
    },
    {
      "id": "n04",
      "concept": "精确率",
      "example": "垃圾邮件过滤：精确率高等于拦住的基本都是真垃圾；召回率高等于真垃圾基本没漏掉。更怕误杀就盯精确率，更怕漏判就盯召回率，两者权衡靠调整判定阈值。",
      "chapter": "第 11 章 11.1",
      "link": "—"
    },
    {
      "id": "n05",
      "concept": "判别模型",
      "example": "逻辑回归和图像分类 CNN 是判别模型；朴素贝叶斯、变分自编码器、GAN 是生成式模型。花书 7.6 节讲了让 P(x) 和 P(y 给定 x) 共享参数、联合训练的做法。",
      "chapter": "第 16–20 章（7.6 节半监督共享）",
      "link": "t10"
    },
    {
      "id": "n06",
      "concept": "梯度消失",
      "example": "用普通 RNN 做长达几百步的序列任务时，最早几个时间步收不到有效梯度，这就是消失；换成 LSTM 让细胞状态走近似线性的通路后可缓解。",
      "chapter": "第 8 章 8.2 / 第 10 章 10.7、10.10",
      "link": "t04 / t05"
    },
    {
      "id": "n07",
      "concept": "L2 正则化",
      "example": "特征上万但只有少数真正相关时用 L1 做稀疏筛选；特征都有一点用、只想单纯防过拟合时用 L2。",
      "chapter": "第 7 章 7.1",
      "link": "—"
    },
    {
      "id": "n08",
      "concept": "验证集",
      "example": "用验证集决定早停轮数和学习率，最后只用一次测试集报最终指标；如果你在测试集上表现不好就回头改主意，那这个测试集其实已经变成验证集了。",
      "chapter": "第 5 章 5.3 / 第 7 章 7.8 / 第 11 章 11.4",
      "link": "—"
    }
  ]
};
