/* e04 · 多项式阶数看过拟合与欠拟合 — 5.2 容量、过拟合和欠拟合 · 印刷页 P.97 · 配套设计 */
(function () {
  "use strict";
  var P = LAB.palette;

  /* 固定种子：训练集与测试集各用一个（结果可复现） */
  var TRAIN_SEED = 5599;
  var TEST_SEED = 5600;
  var TEST_N = 40;

  LAB.register("e04", {
    title: "多项式阶数看过拟合与欠拟合",
    build: function (app) {
      var ui = LAB.shell(app, {
        id: "E04",
        title: "多项式阶数看过拟合与欠拟合",
        source: "5.2 容量、过拟合和欠拟合 · 印刷页 P.97 · 配套设计",
        tag: "配套设计",
        purpose: "找到测试误差由降转升的拐点——那就是过拟合发生的位置。",
        conclusion:
          "阶数低时两条误差都高（欠拟合）；阶数拉高后训练误差一路降到近 0，测试误差反而回升——中间的谷底就是最优容量。",
        acceptance:
          "deg=3 的测试 RMSE（0.158）应小于 deg=12（0.524）；deg 增大时训练 RMSE 单调下降（0.115 → 0.019）",
        metricLabels: ["训练 RMSE", "测试 RMSE", "泛化差距", "参数个数"],
      });

      /* 参数（默认值见规格书） */
      var deg = 9, noise = 0.15, n = 16;

      /* 数据与拟合结果（正规方程为即时计算，改参数就重算一次） */
      var train = [], test = [], w = [];
      var trainRmse = 0, testRmse = 0, gap = 0;
      var reveal = 1; /* 拟合曲线出现动画，由 LAB.loop 推进 */

      /* ================= 数据生成（固定种子） ================= */
      /* 训练 n 点：x_i = -1 + 2(i+0.5)/n + 抖动(±0.015)，y_i = sin(πx_i) + noise × 标准正态 */
      function genData(seed, count) {
        var r = LAB.rng(seed);
        var pts = [];
        for (var i = 0; i < count; i++) {
          var x = -1 + (2 * (i + 0.5)) / count + (r() * 2 - 1) * 0.015;
          pts.push([x, Math.sin(Math.PI * x) + noise * r.gauss()]);
        }
        return pts;
      }

      /* ================= 正规方程求解 ================= */
      /* Neumaier 补偿求和：高次幂累加的舍入误差会破坏训练误差的单调性 */
      function accNew() { return { s: 0, c: 0 }; }
      function accAdd(a, x) {
        var t = a.s + x;
        if (Math.abs(a.s) >= Math.abs(x)) a.c += (a.s - t) + x;
        else a.c += (x - t) + a.s;
        a.s = t;
      }
      function accVal(a) { return a.s + a.c; }

      /* 高斯消元（带部分选主元），A 就地破坏 */
      function gauss(A, b) {
        var len = b.length, i, j, k;
        for (i = 0; i < len; i++) {
          var piv = i, best = Math.abs(A[i][i]);
          for (k = i + 1; k < len; k++) {
            var v = Math.abs(A[k][i]);
            if (v > best) { best = v; piv = k; }
          }
          if (piv !== i) {
            var tmp = A[i]; A[i] = A[piv]; A[piv] = tmp;
            var tb = b[i]; b[i] = b[piv]; b[piv] = tb;
          }
          var d = A[i][i] || 1e-300;
          for (k = i + 1; k < len; k++) {
            var f = A[k][i] / d;
            if (f === 0) continue;
            for (j = i; j < len; j++) A[k][j] -= f * A[i][j];
            b[k] -= f * b[i];
          }
        }
        var out = new Array(len);
        for (i = len - 1; i >= 0; i--) {
          var s = b[i];
          for (j = i + 1; j < len; j++) s -= A[i][j] * out[j];
          out[i] = s / (A[i][i] || 1e-300);
        }
        return out;
      }

      /* 设计矩阵 deg+1 列，row[j] = x^j；解 (XᵀX + 1e-9·I) w = Xᵀy */
      function fitPoly(pts, order) {
        var D = order + 1, i, j, k;
        var g = [], rhs = [];
        for (j = 0; j < D; j++) {
          var rowAcc = [];
          for (k = 0; k < D; k++) rowAcc.push(accNew());
          g.push(rowAcc);
          rhs.push(accNew());
        }
        for (i = 0; i < pts.length; i++) {
          var row = [1], x = pts[i][0];
          for (j = 1; j < D; j++) row.push(row[j - 1] * x);
          for (j = 0; j < D; j++) {
            for (k = 0; k <= j; k++) accAdd(g[j][k], row[j] * row[k]);
            accAdd(rhs[j], row[j] * pts[i][1]);
          }
        }
        var A = [], b = [];
        for (j = 0; j < D; j++) {
          var ar = [];
          for (k = 0; k < D; k++) ar.push(k <= j ? accVal(g[j][k]) : 0);
          A.push(ar);
          b.push(accVal(rhs[j]));
        }
        for (j = 0; j < D; j++) {
          for (k = 0; k < j; k++) A[k][j] = A[j][k]; /* 对称 */
          A[j][j] += 1e-9;
        }
        return gauss(A, b);
      }

      function evalPoly(x) {
        var s = 0, p = 1;
        for (var j = 0; j < w.length; j++) { s += w[j] * p; p *= x; }
        return s;
      }

      function rmseOf(pts) {
        var acc = accNew();
        for (var i = 0; i < pts.length; i++) {
          var d = evalPoly(pts[i][0]) - pts[i][1];
          accAdd(acc, d * d);
        }
        return Math.sqrt(accVal(acc) / pts.length);
      }

      function recompute() {
        train = genData(TRAIN_SEED, n);
        test = genData(TEST_SEED, TEST_N);
        w = fitPoly(train, deg);
        trainRmse = rmseOf(train);
        testRmse = rmseOf(test);
        gap = testRmse - trainRmse;
      }

      /* ================= 控件：改参数 → 立即重算 → 重绘 ================= */
      ui.control(LAB.slider({
        label: "多项式阶数", min: 1, max: 14, step: 1, value: deg,
        fmt: function (v) { return String(v); },
        onInput: function (v) { deg = v; recompute(); reveal = 0; draw(); },
      }));
      /* 步长取 0.01：若按 0.02 取步，0 起步的格点落不到规格默认值 0.15（会被吸附成 0.16） */
      ui.control(LAB.slider({
        label: "噪声强度", min: 0, max: 0.5, step: 0.01, value: noise,
        fmt: function (v) { return v.toFixed(2); },
        onInput: function (v) { noise = v; recompute(); reveal = 0; draw(); },
      }));
      ui.control(LAB.slider({
        label: "训练样本数", min: 6, max: 60, step: 2, value: n,
        fmt: function (v) { return String(v); },
        onInput: function (v) { n = v; recompute(); reveal = 0; draw(); },
      }));

      /* ================= 绘制（单画布，开头统一清屏一次） ================= */
      var cv = LAB.fitCanvas(document.createElement("canvas"), draw);
      ui.stage.appendChild(cv.canvas);

      function draw() {
        var wpx = cv.canvas.clientWidth, hpx = cv.canvas.clientHeight;
        if (!wpx || !hpx) return;
        var ctx = cv.ctx;
        ctx.clearRect(0, 0, wpx, hpx);

        var padL = 46, padR = 20, padT = 20, padB = 40;
        var pw = wpx - padL - padR, ph = hpx - padT - padB;
        if (pw < 60 || ph < 60) return;
        var m = LAB.plotMap(padL, padT, pw, ph, [-1.05, 1.05], [-1.9, 1.9]);
        LAB.axes(ctx, m, {
          xticks: [-1, -0.5, 0, 0.5, 1],
          yticks: [-1.5, -0.75, 0, 0.75, 1.5],
          xlab: "x",
          ylab: "y",
        });

        /* 真实曲线 sin(πx)：灰虚线（固定 ±1.9 内） */
        var truth = [];
        for (var i = 0; i <= 200; i++) {
          var xt = -1.05 + (2.1 * i) / 200;
          truth.push([m.x(xt), m.y(Math.sin(Math.PI * xt))]);
        }
        LAB.polyline(ctx, truth, "rgba(255,255,255,0.35)", 1.5, [5, 4]);

        /* 拟合曲线：青色，reveal 控制出现长度（由 LAB.loop 推进） */
        var total = 240, last = Math.max(1, Math.round(total * reveal));
        var curve = [];
        for (var t = 0; t <= last; t++) {
          var x = -1.05 + (2.1 * t) / total;
          curve.push([m.x(x), m.y(evalPoly(x))]);
        }
        LAB.polyline(ctx, curve, P.cyan, 2.2);

        /* 散点：训练蓝、测试紫 */
        for (var a = 0; a < train.length; a++) LAB.dot(ctx, m.x(train[a][0]), m.y(train[a][1]), 3.6, P.primary);
        for (var b = 0; b < test.length; b++) LAB.dot(ctx, m.x(test[b][0]), m.y(test[b][1]), 3.6, P.accent);

        /* 右上角图例 */
        LAB.legend(ctx, [
          { color: P.primary, label: "训练集（" + n + " 点）" },
          { color: P.accent, label: "测试集（" + TEST_N + " 点）" },
          { color: P.cyan, label: "拟合 " + deg + " 阶" },
          { color: "rgba(255,255,255,0.35)", label: "真实 sin(πx)" },
        ], Math.max(m.x(m.xlim[0]) + 6, m.x(m.xlim[1]) - 132), m.y(m.ylim[1]) + 16);

        /* 指标：泛化差距 = 测试 RMSE − 训练 RMSE */
        var tone = gap > 0.1 ? "fail" : (gap < 0.02 ? "pass" : "hot");
        ui.metrics.set(0, trainRmse.toFixed(4), trainRmse < 0.03 ? "hot" : "");
        ui.metrics.set(1, testRmse.toFixed(4), tone);
        ui.metrics.set(2, (gap >= 0 ? "+" : "") + gap.toFixed(4), tone);
        ui.metrics.set(3, String(deg + 1), deg + 1 > n ? "hot" : "");
        /* 注：lab.js 的 metrics.set 会在 tone 前补 "is-"，故这里传 pass/fail/hot */
      }

      /* 单一 RAF 循环：只负责拟合曲线的出现动画 */
      LAB.loop(function (dt) {
        if (reveal < 1) {
          reveal = Math.min(1, reveal + dt * 5);
          draw();
        }
      });

      recompute();
      draw();
    },
  });
})();
