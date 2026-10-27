/* e21 · Dropout 开关对比 — 7.12 Dropout · 印刷页 P.222 · 配套设计 */
(function () {
  "use strict";
  var P = LAB.palette;

  LAB.register("e21", {
    title: "Dropout 开关对比",
    build: function (app) {
      var ui = LAB.shell(app, {
        id: "E21",
        title: "Dropout 开关对比",
        source: "7.12 Dropout · 印刷页 P.222 · 配套设计",
        tag: "配套设计",
        purpose: "开 Dropout 后训练准确率变低、但训练与测试的 gap 收窄。",
        conclusion:
          "关掉 Dropout 时训练准确率一路飙高但测试上不去（gap 大）；开启后训练准确率被压低，gap 明显收窄——这就是「拿训练误差换泛化」。",
        acceptance:
          "400 步后曲线可读（开启时参考 train 93.3% / test 90.0% / gap 3.3pp）；关闭 Dropout 时的 gap 必须不小于开启时，否则实验失效。",
        metricLabels: ["训练准确率", "测试准确率", "泛化 gap", "迭代步数"],
      });

      /* ---- 固定种子：数据 / 权重初始化 / 批次抽样 / dropout 掩码，重置时重新播种 ---- */
      var SEED_DATA = 72122, SEED_INIT = 72102, SEED_SHUF = 72103, SEED_MASK = 72104;
      /* ---- 固定超参：mini-batch SGD ---- */
      var LR = 0.08, BATCH = 24, NH = 16, INIT = 0.7;

      var drop = "on", p = 0.5, noise = 0.9;
      var running = true;
      var steps = 0;
      var histS = [], histTr = [], histTe = [];
      var accTr = 0, accTe = 0;

      /* 训练状态（reset 时重建） */
      var Xtr = null, Ytr = null, Xte = null, Yte = null;
      var W1 = null, b1 = null, W2 = null, b2 = 0;
      var rs = null, rm = null, order = [], ptr = 0;

      /* ================= 控件 ================= */
      ui.control(LAB.segment({
        label: "Dropout 开关",
        value: "on",
        options: [{ value: "off", label: "关闭" }, { value: "on", label: "开启" }],
        onChange: function (v) { drop = v; reset(); draw(); },
      }));
      ui.control(LAB.slider({
        label: "丢弃概率", min: 0.1, max: 0.7, step: 0.05, value: 0.5,
        fmt: function (v) { return v.toFixed(2); },
        onInput: function (v) { p = v; reset(); draw(); },
      }));
      ui.control(LAB.slider({
        label: "数据噪声", min: 0.2, max: 1.6, step: 0.1, value: 0.9,
        fmt: function (v) { return v.toFixed(1); },
        onInput: function (v) { noise = v; reset(); draw(); },
      }));
      var runBtn = LAB.btn("暂停", function () {
        running = !running;
        runBtn.textContent = running ? "暂停" : "运行";
      }, true);
      ui.control(runBtn);
      ui.control(LAB.btn("重置", function () { reset(); draw(); }));

      /* ================= 数据 ================= */
      /* 两团高斯，中心 (±0.425, ±0.425) 对角布局（中心间距 0.85/轴）；
         每维散布 σ = noise/2（默认 noise=0.9 → σ=0.45，可分性 Bayes≈90.9%，
         与验收参考值 train 93.3% / test 90.0% 对应）；训练 120 条、测试 120 条 */
      function makeData() {
        var c = 0.425, sd = noise / 2;
        var r = LAB.rng(SEED_DATA);
        var ctrs = [[c, c], [-c, -c]];
        var Xa = [], Ya = [], Xb = [], Yb = [];
        function gen(n, cc, y, XS, YS) {
          for (var i = 0; i < n; i++) {
            XS.push([cc[0] + r.gauss() * sd, cc[1] + r.gauss() * sd]);
            YS.push(y);
          }
        }
        gen(60, ctrs[0], 1, Xa, Ya);
        gen(60, ctrs[1], 0, Xa, Ya);
        gen(60, ctrs[0], 1, Xb, Yb);
        gen(60, ctrs[1], 0, Xb, Yb);
        Xtr = Xa; Ytr = Ya; Xte = Xb; Yte = Yb;
      }

      /* ================= 评估（评估路径永远不含 dropout） ================= */
      function predict(X, i) {
        var z = 0, q, act;
        for (q = 0; q < NH; q++) {
          act = W1[q][0] * X[i][0] + W1[q][1] * X[i][1] + b1[q];
          z += W2[q] * (act > 0 ? act : 0);          /* 隐藏层 relu */
        }
        return 1 / (1 + Math.exp(-(z + b2)));        /* 输出层 sigmoid */
      }
      function accuracy(X, Y) {
        var ok = 0;
        for (var i = 0; i < X.length; i++) {
          if ((predict(X, i) >= 0.5 ? 1 : 0) === Y[i]) ok++;
        }
        return ok / X.length;
      }
      /* 每 10 步在完整训练集 / 测试集上各算一次准确率 */
      function record() {
        accTr = accuracy(Xtr, Ytr);
        accTe = accuracy(Xte, Yte);
        histS.push(steps);
        histTr.push(accTr);
        histTe.push(accTe);
      }

      /* ================= 训练 ================= */
      function nextBatch() {
        if (ptr + BATCH > order.length) {
          order = [];
          var i, j, t;
          for (i = 0; i < Xtr.length; i++) order.push(i);
          for (i = Xtr.length - 1; i > 0; i--) {     /* Fisher-Yates 洗牌 */
            j = rs.int(i + 1);
            t = order[i]; order[i] = order[j]; order[j] = t;
          }
          ptr = 0;
        }
        var b = order.slice(ptr, ptr + BATCH);
        ptr += BATCH;
        return b;
      }

      /* mini-batch SGD 一步：前向 + 反向 + 按批次均值更新 */
      function trainStep() {
        if (!Xtr) return;
        var idx = nextBatch();
        var gW1 = [], gb1 = [], gW2 = [], gb2 = 0, q;
        for (q = 0; q < NH; q++) { gW1.push([0, 0]); gb1.push(0); gW2.push(0); }
        var keep = 1 - p;
        var on = drop === "on";

        for (var s = 0; s < idx.length; s++) {
          var i = idx[s];
          var h = [], m = [];
          for (q = 0; q < NH; q++) {
            var act = W1[q][0] * Xtr[i][0] + W1[q][1] * Xtr[i][1] + b1[q];
            h[q] = act > 0 ? act : 0;
            /* inverted dropout：mask = 1/(1-p) 或 0（关闭时不消耗掩码随机数） */
            m[q] = on ? ((rm() < keep ? 1 : 0) / keep) : 1;
          }
          /* 输出层权重按 mask 缩放：z = Σ (W2·mask)·h（等价于 W[1][q][w] *= mask[w]） */
          var z = b2;
          for (q = 0; q < NH; q++) z += W2[q] * m[q] * h[q];
          var o = 1 / (1 + Math.exp(-z));
          var dz = o - Ytr[i];                        /* sigmoid + 交叉熵合并梯度 */
          for (q = 0; q < NH; q++) {
            /* 对缩放后的权重求梯度；存盘权重始终是原权重（算完即恢复语义） */
            gW2[q] += dz * h[q];
            var dh = dz * (W2[q] * m[q]);             /* 反传穿过缩放权重 */
            if (h[q] > 0) {                           /* relu 门 */
              gW1[q][0] += dh * Xtr[i][0];
              gW1[q][1] += dh * Xtr[i][1];
              gb1[q] += dh;
            }
          }
          gb2 += dz;
        }

        /* 梯度必须取批次均值后再更新（求和会放大几十倍有效学习率导致发散） */
        var n = idx.length;
        for (q = 0; q < NH; q++) {
          W1[q][0] -= LR * gW1[q][0] / n;
          W1[q][1] -= LR * gW1[q][1] / n;
          b1[q] -= LR * gb1[q] / n;
          W2[q] -= LR * gW2[q] / n;
        }
        b2 -= LR * gb2 / n;

        steps++;
        if (steps % 10 === 0) record();
      }

      /* ================= 重置（重新播种全部随机序列） ================= */
      function reset() {
        makeData();
        var ri = LAB.rng(SEED_INIT), q;
        W1 = []; b1 = []; W2 = []; b2 = 0;
        for (q = 0; q < NH; q++) {
          W1.push([ri.gauss() * INIT, ri.gauss() * INIT]);
          b1.push(0);
        }
        for (q = 0; q < NH; q++) W2.push(ri.gauss() * INIT);
        rs = LAB.rng(SEED_SHUF);
        rm = LAB.rng(SEED_MASK);
        order = []; ptr = 0;
        steps = 0;
        histS = []; histTr = []; histTe = [];
        running = true;
        runBtn.textContent = "暂停";
        record();                                     /* 步数 0 的起点 */
      }

      /* ================= 渲染：单画布双曲线 ================= */
      /* x 轴刻度取 1/2/5×10^k 的整数步长 */
      function niceTicks(max) {
        var raw = max / 4;
        var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
        var norm = raw / mag;
        var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
        var out = [];
        for (var t = 0; t <= max + 1e-9; t += step) out.push(Math.round(t * 100) / 100);
        return out;
      }

      var cv = LAB.fitCanvas(document.createElement("canvas"), draw);
      ui.stage.appendChild(cv.canvas);

      function draw() {
        if (!cv) return;                             /* fitCanvas 首次同步回调时 cv 尚未赋值 */
        var wpx = cv.canvas.clientWidth, hpx = cv.canvas.clientHeight;
        if (!wpx || !hpx || !W1) return;
        var ctx = cv.ctx;
        ctx.clearRect(0, 0, wpx, hpx);                /* 整块画布只清一次 */

        var padL = 48, padR = 18, padT = 18, padB = 42;
        var px = padL, py = padT;
        var pw = Math.max(40, wpx - padL - padR);
        var ph = Math.max(40, hpx - padT - padB);
        var xmax = Math.max(200, steps);              /* x 轴 0 ~ max(200, 步数) */
        var m = LAB.plotMap(px, py, pw, ph, [0, xmax], [0.35, 1.0]);  /* y 轴固定 0.35~1.0 */
        LAB.axes(ctx, m, {
          xticks: niceTicks(xmax),
          yticks: [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
          yfmt: function (v) { return (v * 100).toFixed(0) + "%"; },
          xlab: "迭代步数",
          ylab: "准确率",
        });

        function pts(arr) {
          var out = [];
          for (var i = 0; i < arr.length; i++) {
            out.push([m.x(histS[i]), m.y(Math.max(0.35, Math.min(1, arr[i])))]);
          }
          return out;
        }
        LAB.polyline(ctx, pts(histTr), P.primary, 2); /* 训练准确率（蓝） */
        LAB.polyline(ctx, pts(histTe), P.cyan, 2);    /* 测试准确率（青） */
        LAB.legend(ctx, [
          { color: P.primary, label: "训练准确率" },
          { color: P.cyan, label: "测试准确率" },
        ], px + 12, py + 12);

        /* 指标：训练准确率 / 测试准确率 / 泛化 gap（百分点）/ 迭代步数 */
        if (histTr.length) {
          var gap = (accTr - accTe) * 100;
          ui.metrics.set(0, (accTr * 100).toFixed(1) + "%");
          ui.metrics.set(1, (accTe * 100).toFixed(1) + "%", "hot");
          ui.metrics.set(2, gap.toFixed(1) + "pp", gap >= 5 ? "fail" : (gap <= 2 ? "pass" : ""));
        } else {
          ui.metrics.set(0, "—");
          ui.metrics.set(1, "—");
          ui.metrics.set(2, "—");
        }
        ui.metrics.set(3, String(steps));
      }

      /* ================= 单一循环：每帧推进 2 个 mini-batch 步 ================= */
      LAB.loop(function () {
        if (!running) return;
        trainStep();
        trainStep();
        draw();
      });

      reset();
      draw();
    },
  });
})();
