/* e27 · 手工卷积核 → 可学习卷积核 — 9.1 卷积运算 · 9.2 动机 · p282 · 配套设计 */
(function () {
  "use strict";
  var P = LAB.palette;

  LAB.register("e27", {
    title: "手工卷积核 → 可学习卷积核",
    build: function (app) {
      var ui = LAB.shell(app, {
        id: "E27",
        title: "手工卷积核 → 可学习卷积核",
        source: "9.1 卷积运算 · 9.2 动机 · 印刷页 P.282 · 配套设计",
        tag: "配套设计",
        purpose: "先看懂卷积在提取什么，再让网络自己学出同样的东西。",
        conclusion:
          "手工核能立刻看懂「卷积在提取什么」。切到随机初始化再运行，核会自己收敛成类似 Sobel 的权重——这就是「卷积核是可学习的特征提取器」。",
        acceptance:
          "随机初始化训练 400 步后，MSE 从约 1.21e-1 降到 < 1e-3（应达 8e-4 量级），学到的核与 Sobel 的余弦相似度 > 0.9（应达 0.98）",
        metricLabels: ["模式", "训练步数", "与 Sobel 的 MSE", "核尺寸", "余弦相似度"],
      });

      var N = 64;
      var SEED = 10731;      /* 固定种子：初始 MSE ≈ 1.2e-1，400 步后达验收指标 */
      var LR = 0.5;
      var STEPS_PER_FRAME = 3;

      /* ============ 64×64 程序化灰度图（i 行 j 列） ============ */
      var img = [];
      for (var i = 0; i < N; i++) {
        img[i] = [];
        for (var j = 0; j < N; j++) {
          var v = 0.35;
          if (i > 10 && i < 30 && j > 10 && j < 30) v = 0.85;          /* 亮方块 */
          if ((i - 44) * (i - 44) + (j - 20) * (j - 20) < 100) v = 0.12; /* 暗圆 */
          if (Math.abs(j - 0.7 * i - 6) < 0.9) v = 0.95;                /* 亮斜线 */
          img[i][j] = v;
        }
      }

      function clampIdx(x) { return x < 0 ? 0 : x > N - 1 ? N - 1 : x; }

      /* 3×3 相关运算，边界 clamp；out 为 Float64Array(N*N) */
      function conv(k, out) {
        for (var i = 0; i < N; i++) {
          for (var j = 0; j < N; j++) {
            var s = 0;
            for (var m = 0; m < 3; m++) {
              var row = img[clampIdx(i + m - 1)];
              for (var n = 0; n < 3; n++) s += k[m * 3 + n] * row[clampIdx(j + n - 1)];
            }
            out[i * N + j] = s;
          }
        }
      }

      /* ============ 预设核与 Sobel 目标（只算一次并缓存） ============ */
      var PRESETS = {
        sobel: { label: "Sobel-x", k: [-1, 0, 1, -2, 0, 2, -1, 0, 1] },
        mean: { label: "均值", k: [1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9] },
        sharp: { label: "锐化", k: [0, -1, 0, -1, 5, -1, 0, -1, 0] },
        emboss: { label: "浮雕", k: [-2, -1, 0, -1, 1, 1, 0, 1, 2] },
        id: { label: "恒等", k: [0, 0, 0, 0, 1, 0, 0, 0, 0] },
      };
      var sobelK = PRESETS.sobel.k;
      var target = new Float64Array(N * N);
      conv(sobelK, target); /* Sobel 目标图缓存，训练中不再重算 */

      var interior = (N - 2) * (N - 2); /* 损失只取内部像素（去掉 1 圈边界） */

      /* 内部像素 MSE：当前核输出 vs Sobel 目标 */
      function mseVs(k) {
        var out = new Float64Array(N * N);
        conv(k, out);
        var s = 0;
        for (var i = 1; i < N - 1; i++)
          for (var j = 1; j < N - 1; j++) {
            var e = out[i * N + j] - target[i * N + j];
            s += e * e;
          }
        return s / interior;
      }

      /* ============ 状态 ============ */
      var mode = "sobel";
      var k = PRESETS.sobel.k.slice();
      var steps = 0;
      var running = false;
      var feat = new Float64Array(N * N); /* 当前核的特征图（绘制用） */
      var mse = 0;

      function randomKernel() {
        var r = LAB.rng(SEED);
        var out = [];
        for (var w = 0; w < 9; w++) out.push(r.gauss() * 0.3);
        return out;
      }

      function applyKernel() {
        k = mode === "rand" ? randomKernel() : PRESETS[mode].k.slice();
      }

      /* 训练一步：MSE 对核的梯度 ∂L/∂k[m][n] = 2·Σ((pred−d)·img[j+m][i+n]) / N */
      function trainStep() {
        conv(k, feat);
        var g = [0, 0, 0, 0, 0, 0, 0, 0, 0];
        for (var i = 1; i < N - 1; i++)
          for (var j = 1; j < N - 1; j++) {
            var e = (2 * (feat[i * N + j] - target[i * N + j])) / interior;
            for (var m = 0; m < 3; m++) {
              var row = img[clampIdx(i + m - 1)];
              for (var n = 0; n < 3; n++) g[m * 3 + n] += e * row[clampIdx(j + n - 1)];
            }
          }
        for (var w = 0; w < 9; w++) k[w] -= LR * g[w];
        steps++;
      }

      function cosine() {
        var dot = 0, na = 0, nb = 0;
        for (var w = 0; w < 9; w++) {
          dot += k[w] * sobelK[w];
          na += k[w] * k[w];
          nb += sobelK[w] * sobelK[w];
        }
        return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
      }

      /* ============ 控件 ============ */
      ui.control(LAB.segment({
        label: "卷积核",
        value: "sobel",
        options: [
          { value: "sobel", label: "边缘(Sobel-x)" },
          { value: "mean", label: "模糊(均值)" },
          { value: "sharp", label: "锐化" },
          { value: "emboss", label: "浮雕" },
          { value: "id", label: "恒等" },
          { value: "rand", label: "随机初始化" },
        ],
        onChange: function (v) { mode = v; reset(); },
      }));
      var runBtn = LAB.btn("运行", function () {
        running = !running;
        syncRunBtn();
      }, true);
      ui.control(runBtn);
      ui.control(LAB.btn("重置", function () { reset(); }));

      function syncRunBtn() {
        runBtn.disabled = mode !== "rand";
        runBtn.textContent = running ? "暂停" : "运行";
      }

      function reset() {
        applyKernel();
        steps = 0;
        running = false;
        syncRunBtn();
      }

      /* ============ 舞台：左原图 + 核数值格，右特征图 + 图例/MSE ============ */
      var split = LAB.el("div", "lab-stage-split");
      split.style.gridTemplateColumns = "1fr 1fr";

      var hostL = LAB.el("div", "lab-canvas-host");
      hostL.appendChild(LAB.el("div", "lab-pane-label", "原图"));
      var cvL = document.createElement("canvas");
      hostL.appendChild(cvL);

      /* 3×3 卷积核数值格（正值蓝、负值紫，深浅按幅度） */
      var kernBox = LAB.el("div", "lab-kernel");
      var kspans = [];
      for (var w = 0; w < 9; w++) {
        var sp = LAB.el("span");
        sp.style.color = "#e8ecf8";
        kernBox.appendChild(sp);
        kspans.push(sp);
      }
      hostL.appendChild(kernBox);

      var hostR = LAB.el("div", "lab-canvas-host");
      hostR.appendChild(LAB.el("div", "lab-pane-label", "特征图"));
      var cvR = document.createElement("canvas");
      hostR.appendChild(cvR);
      var overlay = LAB.el("div", "lab-overlay");
      var ov1 = LAB.el("span"); ov1.appendChild(chip("rgba(76,125,255,0.9)")); ov1.appendChild(document.createTextNode("核权重正"));
      var ov2 = LAB.el("span"); ov2.appendChild(chip("rgba(167,139,250,0.9)")); ov2.appendChild(document.createTextNode("核权重负"));
      var ov3 = LAB.el("span");
      ov3.appendChild(chip(P.cyan));
      ov3.appendChild(document.createTextNode("MSE "));
      var ovMse = LAB.el("b", null, "—");
      ovMse.style.color = P.cyan;
      ovMse.style.fontFamily = "ui-monospace, Consolas, monospace";
      ov3.appendChild(ovMse);
      overlay.appendChild(ov1);
      overlay.appendChild(ov2);
      overlay.appendChild(ov3);
      hostR.appendChild(overlay);

      split.appendChild(hostL);
      split.appendChild(hostR);
      ui.stage.appendChild(split);

      function chip(color) {
        var bar = document.createElement("i");
        bar.style.background = color;
        return bar;
      }

      /* 离屏 64×64 灰度缓冲 */
      function makeOff() {
        var c = document.createElement("canvas");
        c.width = N;
        c.height = N;
        return c;
      }
      var offL = makeOff(), offR = makeOff();
      var ctxL = offL.getContext("2d"), ctxR = offR.getContext("2d");
      var imL = ctxL.createImageData(N, N), imR = ctxR.createImageData(N, N);

      function fillOrig() {
        var d = imL.data;
        for (var i = 0; i < N * N; i++) {
          var g = Math.round(255 * img[(i / N) | 0][i % N]); /* 灰阶直绘 */
          var p = i * 4;
          d[p] = g; d[p + 1] = g; d[p + 2] = g; d[p + 3] = 255;
        }
        ctxL.putImageData(imL, 0, 0);
      }

      function fillFeat() {
        var d = imR.data;
        for (var i = 0; i < N * N; i++) {
          var g = (feat[i] + 1) / 2; /* (v+1)/2 对称归一化 */
          g = g < 0 ? 0 : g > 1 ? 1 : g;
          var q = Math.round(255 * g);
          var p = i * 4;
          d[p] = q; d[p + 1] = q; d[p + 2] = q; d[p + 3] = 255;
        }
        ctxR.putImageData(imR, 0, 0);
      }

      function paint(cv, off) {
        var w = cv.clientWidth, h = cv.clientHeight;
        if (!w || !h) return;
        var ctx = cv.getContext("2d");
        var side = Math.min(w, h) - 18;
        if (side < 32) return;
        ctx.clearRect(0, 0, w, h);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(off, Math.round((w - side) / 2), Math.round((h - side) / 2), side, side);
      }

      LAB.fitCanvas(cvL, function (w, h, ctx) { paint(cvL, offL); });
      LAB.fitCanvas(cvR, function (w, h, ctx) { paint(cvR, offR); });

      function updateKernelSpans() {
        var mx = 1e-9;
        for (var w = 0; w < 9; w++) mx = Math.max(mx, Math.abs(k[w]));
        for (w = 0; w < 9; w++) {
          var a = 0.15 + 0.75 * (Math.abs(k[w]) / mx); /* 幅度归一化 0.15–0.9 */
          kspans[w].textContent = k[w].toFixed(2);
          kspans[w].style.background = k[w] >= 0
            ? "rgba(76,125,255," + a.toFixed(3) + ")"
            : "rgba(167,139,250," + a.toFixed(3) + ")";
        }
      }

      function draw() {
        conv(k, feat);
        mse = mseVs(k); /* 与 Sobel 目标输出的内部 MSE */
        fillOrig();
        fillFeat();
        paint(cvL, offL);
        paint(cvR, offR);
        updateKernelSpans();

        var cosv = cosine();
        ui.metrics.set(0, mode === "rand" ? "可学习核" : "手工核 · " + PRESETS[mode].label);
        ui.metrics.set(1, String(steps));
        ui.metrics.set(2, mse.toExponential(2), "is-hot"); /* MSE 用青色 */
        ui.metrics.set(3, "3×3");
        ui.metrics.set(4, cosv.toFixed(3));
        ovMse.textContent = mse.toExponential(2);
      }

      /* ============ 单一循环：训练模式每帧 3 步 ============ */
      LAB.loop(function () {
        if (running && mode === "rand") {
          for (var s = 0; s < STEPS_PER_FRAME; s++) trainStep();
        }
        draw();
      });

      reset();
      draw();
    },
  });
})();
