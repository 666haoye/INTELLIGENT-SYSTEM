/* e12 · 两层 MLP 解决 XOR — 6.1 实例：学习XOR · 印刷页 P.148 · 配套设计 */
(function () {
  "use strict";
  var P = LAB.palette;

  LAB.register("e12", {
    title: "两层 MLP 解决 XOR",
    build: function (app) {
      var ui = LAB.shell(app, {
        id: "E12",
        title: "两层 MLP 解决 XOR",
        source: "6.1 实例：学习XOR · 印刷页 P.148 · 配套设计",
        tag: "配套设计",
        purpose: "看决策区域从一条直线变成能拐弯的两块，准确率冲到 100%。",
        conclusion:
          "与 e11 同一份数据，只多一层隐藏单元，准确率从封顶 75% 变成 100%。隐藏层把 XOR 变成了线性可分——这就是「学表示」。",
        acceptance: "XOR + 2 层隐藏，训练 1500 步后准确率 ≥ 99.9%，loss 降到 1e-3 量级。",
        metricLabels: ["迭代步数", "当前 loss", "训练准确率", "网络结构"],
      });

      /* ================= 状态 ================= */
      var dataset = "xor", hidden = 2, units = 4, lr = 0.6, act = "relu";
      var running = true, steps = 0, loss = NaN;
      var X = [], Y = [], sizes = [], W = [], B = [], hist = [];
      var logMin = 0, logMax = -1e9;
      var panes = [];
      var SEED_WEIGHT = 12007; /* 权重初始化固定种子：每次重置走同一序列 */
      var runBtn = null;

      /* ================= 数值核心（data / init / forward / backprop） ================= */
      var BASE = [
        [-1, -1, 0], [-1, 1, 1], [1, -1, 1], [1, 1, 0],
      ];

      /* 三套数据均固定种子；XOR = e11 同一份数据（4 点 ×10 份 = 40 样本） */
      function buildData(name) {
        X = []; Y = [];
        var r, i;
        if (name === "circles") {
          r = LAB.rng(12002);
          for (i = 0; i < 40; i++) {
            var a1 = r() * Math.PI * 2;
            var rad1 = 0.35 + r.gauss() * 0.05;
            X.push([Math.cos(a1) * rad1, Math.sin(a1) * rad1]);
            Y.push(1);
          }
          for (i = 0; i < 40; i++) {
            var a2 = r() * Math.PI * 2;
            var rad2 = 0.95 + r.gauss() * 0.06;
            X.push([Math.cos(a2) * rad2, Math.sin(a2) * rad2]);
            Y.push(0);
          }
        } else if (name === "spiral") {
          r = LAB.rng(12003);
          for (var arm = 0; arm < 2; arm++) {
            for (i = 0; i < 50; i++) {
              var t = i / 49;
              var rad = 0.15 + t;
              var ang = t * 1.5 * Math.PI + (arm === 1 ? Math.PI : 0);
              X.push([
                Math.cos(ang) * rad + r.gauss() * 0.03,
                Math.sin(ang) * rad + r.gauss() * 0.03,
              ]);
              Y.push(arm === 1 ? 0 : 1);
            }
          }
        } else {
          for (var b = 0; b < BASE.length; b++) {
            for (i = 0; i < 10; i++) {
              X.push([BASE[b][0], BASE[b][1]]);
              Y.push(BASE[b][2]);
            }
          }
        }
      }

      function initSizes() {
        sizes = [2];
        for (var i = 0; i < hidden; i++) sizes.push(units);
        sizes.push(1);
      }

      /* Xavier：w = U(-1,1) × sqrt(2 / fan_in)，固定种子保证可复现 */
      function initWeights() {
        var r = LAB.rng(SEED_WEIGHT);
        W = []; B = [];
        for (var l = 0; l < sizes.length - 1; l++) {
          var fanIn = sizes[l], out = sizes[l + 1];
          var scale = Math.sqrt(2 / fanIn);
          var wl = [], bl = [];
          for (var j = 0; j < out; j++) {
            var row = [];
            for (var i = 0; i < fanIn; i++) row.push((r() * 2 - 1) * scale);
            wl.push(row);
            bl.push(0);
          }
          W.push(wl);
          B.push(bl);
        }
      }

      function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

      function actv(z) {
        if (act === "relu") return z > 0 ? z : 0;
        return sigmoid(z);
      }

      function dact(z) {
        if (act === "relu") return z > 0 ? 1 : 0;
        var s = sigmoid(z);
        return s * (1 - s);
      }

      /* 前向：返回各层激活 a、各层预激活 z 与输出概率 p */
      function forward(x) {
        var a = [x], zs = [];
        for (var l = 0; l < W.length; l++) {
          var prev = a[l], wl = W[l], bl = B[l], out = [];
          for (var j = 0; j < wl.length; j++) {
            var s = bl[j], row = wl[j];
            for (var i = 0; i < prev.length; i++) s += row[i] * prev[i];
            out.push(s);
          }
          zs.push(out);
          var isLast = l === W.length - 1;
          var next = [];
          for (var j2 = 0; j2 < out.length; j2++) {
            next.push(isLast ? sigmoid(out[j2]) : actv(out[j2]));
          }
          a.push(next);
        }
        return { a: a, zs: zs, p: a[a.length - 1][0] };
      }

      /* 全批量梯度下降：sigmoid 输出 + 交叉熵 → 输出层 δ = p − y；
         隐藏层反传乘激活导数；梯度对全部样本取均值后再更新（严禁求和更新） */
      function step() {
        var n = X.length, l, j, i;
        var gW = [], gB = [];
        for (l = 0; l < W.length; l++) {
          var wl = [], bl = [];
          for (j = 0; j < W[l].length; j++) {
            var row = [];
            for (i = 0; i < W[l][j].length; i++) row.push(0);
            wl.push(row);
            bl.push(0);
          }
          gW.push(wl);
          gB.push(bl);
        }
        var sum = 0;
        for (var s = 0; s < n; s++) {
          var f = forward(X[s]);
          var y = Y[s], p = f.p;
          sum += -(y * Math.log(p + 1e-12) + (1 - y) * Math.log(1 - p + 1e-12));
          var delta = [p - y];
          for (l = W.length - 1; l >= 0; l--) {
            var aPrev = f.a[l];
            for (j = 0; j < W[l].length; j++) {
              gB[l][j] += delta[j];
              for (i = 0; i < aPrev.length; i++) gW[l][j][i] += delta[j] * aPrev[i];
            }
            if (l > 0) {
              var zPrev = f.zs[l - 1], nd = [];
              for (i = 0; i < aPrev.length; i++) {
                var acc = 0;
                for (j = 0; j < W[l].length; j++) acc += W[l][j][i] * delta[j];
                nd.push(acc * dact(zPrev[i]));
              }
              delta = nd;
            }
          }
        }
        for (l = 0; l < W.length; l++) {
          for (j = 0; j < W[l].length; j++) {
            B[l][j] -= lr * gB[l][j] / n;
            for (i = 0; i < W[l][j].length; i++) {
              W[l][j][i] -= lr * gW[l][j][i] / n;
            }
          }
        }
        loss = sum / n;
        steps++;
        if (steps % 4 === 0) {
          var lg = Math.log(Math.max(loss, 1e-12)) / Math.LN10;
          if (lg < logMin) logMin = lg;
          if (lg > logMax) logMax = lg;
          hist.push([steps, lg]);
          if (hist.length > 4000) { /* 保底：长训时抽稀，曲线仍覆盖全程 */
            var nh = [];
            for (var k = 1; k < hist.length; k += 2) nh.push(hist[k]);
            hist = nh;
          }
        }
      }

      function accuracy() {
        var ok = 0;
        for (var s = 0; s < X.length; s++) {
          var pred = forward(X[s]).p >= 0.5 ? 1 : 0;
          if (pred === Y[s]) ok++;
        }
        return ok / X.length;
      }

      function structureText() { return sizes.join("-"); }

      /* 改「层数 / 神经元 / 激活函数 / 数据集」→ 重新初始化权重并重置训练；
         只改学习率不走 reset，继续训练 */
      function reset() {
        buildData(dataset);
        initSizes();
        initWeights();
        steps = 0;
        loss = NaN;
        hist = [];
        logMin = 0;
        logMax = -1e9;
        running = true;
        if (runBtn) runBtn.textContent = "暂停";
      }

      /* ================= 控件 ================= */
      ui.control(LAB.segment({
        label: "数据集",
        value: "xor",
        options: [
          { value: "xor", label: "XOR 异或" },
          { value: "circles", label: "同心圆" },
          { value: "spiral", label: "螺旋" },
        ],
        onChange: function (v) { dataset = v; reset(); redraw(); },
      }));
      ui.control(LAB.slider({
        label: "隐藏层层数", min: 1, max: 3, step: 1, value: 2,
        fmt: function (v) { return String(v); },
        onInput: function (v) { hidden = v; reset(); redraw(); },
      }));
      ui.control(LAB.slider({
        label: "每层神经元", min: 2, max: 8, step: 1, value: 4,
        fmt: function (v) { return String(v); },
        onInput: function (v) { units = v; reset(); redraw(); },
      }));
      ui.control(LAB.slider({
        label: "学习率", min: 0.05, max: 1.6, step: 0.05, value: 0.6,
        fmt: function (v) { return v.toFixed(2); },
        onInput: function (v) { lr = v; /* 只改学习率：不重置，继续训练 */ },
      }));
      ui.control(LAB.segment({
        label: "激活函数",
        value: "relu",
        options: [
          { value: "sigmoid", label: "sigmoid" },
          { value: "relu", label: "relu" },
        ],
        onChange: function (v) { act = v; reset(); redraw(); },
      }));

      runBtn = LAB.btn("暂停", function () {
        running = !running;
        runBtn.textContent = running ? "暂停" : "运行";
        if (!running) redraw();
      }, true);
      ui.control(runBtn);
      ui.control(LAB.btn("单步", function () {
        running = false;
        runBtn.textContent = "运行";
        step();
        redraw();
      }));
      ui.control(LAB.btn("重置", function () { reset(); redraw(); }));

      /* ================= 舞台：1 大 + 右侧上下 2 格，各自独立 canvas ================= */
      var split = LAB.el("div", "lab-stage-split");
      split.style.gridTemplateColumns = "1.2fr 1fr";
      ui.stage.appendChild(split);

      var paneLeft = LAB.el("div", "lab-canvas-host");
      paneLeft.style.borderRight = "1px solid var(--line)";
      split.appendChild(paneLeft);

      var colRight = LAB.el("div", null);
      colRight.style.display = "grid";
      colRight.style.gridTemplateRows = "1fr 1fr";
      colRight.style.minWidth = "0";
      colRight.style.minHeight = "0";
      split.appendChild(colRight);

      var paneLoss = LAB.el("div", "lab-canvas-host");
      paneLoss.style.borderBottom = "1px solid var(--line)";
      var paneNet = LAB.el("div", "lab-canvas-host");
      colRight.appendChild(paneLoss);
      colRight.appendChild(paneNet);

      /* 每格一个 canvas：fitCanvas 负责 DPR 缩放与尺寸变化重绘 */
      function makePane(host, label, drawFn) {
        host.appendChild(LAB.el("span", "lab-pane-label", label));
        var canvas = document.createElement("canvas");
        host.appendChild(canvas);
        var size = { w: 0, h: 0 };
        var cv = LAB.fitCanvas(canvas, function (w, h, ctx) {
          size.w = w;
          size.h = h;
          drawFn(w, h, ctx);
        });
        panes.push(function () {
          if (size.w && size.h) drawFn(size.w, size.h, cv.ctx);
        });
      }

      function redraw() {
        for (var i = 0; i < panes.length; i++) panes[i]();
        updateMetrics();
      }

      function updateMetrics() {
        ui.metrics.set(0, String(steps));
        ui.metrics.set(
          1,
          isNaN(loss) ? "—" : (loss < 1e-3 ? loss.toExponential(2) : loss.toFixed(4)),
          "is-hot"
        );
        var acc = accuracy();
        ui.metrics.set(
          2,
          isNaN(acc) ? "—" : (acc * 100).toFixed(1) + "%",
          acc >= 0.999 ? "is-pass" : ""
        );
        ui.metrics.set(3, structureText());
      }

      /* ================= 决策面 ================= */
      var GRID = 64;
      var gridCanvas = document.createElement("canvas");
      gridCanvas.width = GRID;
      gridCanvas.height = GRID;
      var gridCtx = gridCanvas.getContext("2d");
      var gridImg = gridCtx.createImageData(GRID, GRID);

      function drawDecision(w, h, ctx) {
        ctx.clearRect(0, 0, w, h);
        var pad = 46;
        var side = Math.min(w - pad * 2, h - pad * 1.6);
        if (side < 40) side = Math.max(20, Math.min(w, h) - 12);
        var ox = (w - side) / 2, oy = (h - side) / 2 - 6;
        var m = LAB.plotMap(ox, oy, side, side, [-1.4, 1.4], [-1.4, 1.4]);

        /* 64×64 逐点前向：概率 → 底色 暗蓝 rgba(20,30,70) → 亮青 cyan */
        var d = gridImg.data, idx = 0;
        for (var gy = 0; gy < GRID; gy++) {
          var yy = 1.4 - 2.8 * (gy + 0.5) / GRID;
          for (var gx = 0; gx < GRID; gx++) {
            var xx = -1.4 + 2.8 * (gx + 0.5) / GRID;
            var p = forward([xx, yy]).p;
            d[idx] = 20 + 14 * p;
            d[idx + 1] = 30 + 181 * p;
            d[idx + 2] = 70 + 168 * p;
            d[idx + 3] = 255;
            idx += 4;
          }
        }
        gridCtx.putImageData(gridImg, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(gridCanvas, ox, oy, side, side);

        LAB.axes(ctx, m, { xlab: "x₁", ylab: "x₂" });

        /* 样本点：正类 primary 实心、负类 accent 空心环 */
        if (dataset === "xor") {
          for (var b = 0; b < BASE.length; b++) {
            var bp = BASE[b];
            var bx = m.x(bp[0]), by = m.y(bp[1]);
            if (bp[2] === 1) LAB.dot(ctx, bx, by, 7, P.primary);
            else LAB.ring(ctx, bx, by, 7, P.accent, 2.5);
          }
        } else {
          for (var s = 0; s < X.length; s++) {
            var px = m.x(X[s][0]), py = m.y(X[s][1]);
            if (Y[s] === 1) LAB.dot(ctx, px, py, 3.5, P.primary);
            else LAB.ring(ctx, px, py, 3.2, P.accent, 1.6);
          }
        }

        LAB.legend(ctx, [
          { color: P.primary, label: "正类（1）" },
          { color: P.accent, label: "负类（0）" },
          { color: P.cyan, label: "概率 → 1（亮青）" },
        ], 14, h - 50);
      }

      /* ================= loss 曲线（log10，每 4 步采样） ================= */
      function drawLoss(w, h, ctx) {
        ctx.clearRect(0, 0, w, h);
        var padL = 44, padR = 14, padT = 26, padB = 36;
        var pw = w - padL - padR, ph = h - padT - padB;
        if (pw < 30 || ph < 30) return;
        var xmax = Math.max(400, Math.ceil((steps + 40) / 4) * 4);
        var lo = Math.min(-6, Math.floor(logMin));
        var hi = Math.max(0, Math.ceil(logMax));
        var m = LAB.plotMap(padL, padT, pw, ph, [0, xmax], [lo, hi]);

        var yt = [];
        var stepY = hi - lo > 14 ? Math.ceil((hi - lo) / 8) : 1;
        for (var v = Math.ceil(lo); v <= hi; v += stepY) yt.push(v);
        LAB.axes(ctx, m, {
          xlab: "迭代步数",
          ylab: "log10(loss)",
          xfmt: function (t) { return String(Math.round(t)); },
          yticks: yt,
        });

        /* 验收参考线 loss = 1e-3 */
        if (lo <= -3 && hi >= -3) {
          LAB.polyline(
            ctx,
            [[m.x(0), m.y(-3)], [m.x(xmax), m.y(-3)]],
            "rgba(147,161,196,0.45)", 1, [5, 5]
          );
          ctx.save();
          ctx.fillStyle = "rgba(147,161,196,0.85)";
          ctx.font = "10px ui-monospace, Consolas, monospace";
          ctx.textAlign = "right";
          ctx.textBaseline = "bottom";
          ctx.fillText("验收 1e-3", m.x(xmax) - 2, m.y(-3) - 3);
          ctx.restore();
        }

        if (hist.length === 0) {
          ctx.save();
          ctx.fillStyle = P.muted;
          ctx.font = "11px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("训练中 · 每 4 步采样一个点", padL + pw / 2, padT + ph / 2);
          ctx.restore();
        } else {
          var pts = [];
          for (var i = 0; i < hist.length; i++) {
            pts.push([m.x(hist[i][0]), m.y(hist[i][1])]);
          }
          LAB.polyline(ctx, pts, P.cyan, 2);
          var last = pts[pts.length - 1];
          LAB.dot(ctx, last[0], last[1], 3, P.cyan);
        }
      }

      /* ================= 网络结构 ================= */
      function drawNet(w, h, ctx) {
        ctx.clearRect(0, 0, w, h);
        var padL = 34, padR = 34, padT = 24, padB = 34;
        if (w - padL - padR < 40 || h - padT - padB < 30) return;
        var nL = sizes.length;
        var cols = [], pos = [], l, j, i;

        for (l = 0; l < nL; l++) {
          cols.push(nL === 1 ? w / 2 : padL + (w - padL - padR) * (l / (nL - 1)));
        }
        var cy = (padT + (h - padB)) / 2;
        for (l = 0; l < nL; l++) {
          var cnt = sizes[l];
          var gap = cnt > 1 ? (h - padT - padB) / (cnt - 1) : 0;
          if (gap > 34) gap = 34;
          var col = [];
          for (j = 0; j < cnt; j++) {
            col.push([cols[l], cy + (j - (cnt - 1) / 2) * gap]);
          }
          pos.push(col);
        }

        /* 连线：正权重 cyan、负权重 accent，透明度 / 线宽按 |w| 归一化 */
        var wmax = 1e-8;
        for (l = 0; l < W.length; l++) {
          for (j = 0; j < W[l].length; j++) {
            for (i = 0; i < W[l][j].length; i++) {
              var aw = Math.abs(W[l][j][i]);
              if (aw > wmax) wmax = aw;
            }
          }
        }
        ctx.save();
        for (l = 0; l < W.length; l++) {
          for (j = 0; j < W[l].length; j++) {
            for (i = 0; i < W[l][j].length; i++) {
              var wv = W[l][j][i];
              var t = Math.abs(wv) / wmax;
              ctx.strokeStyle = wv >= 0 ? P.cyan : P.accent;
              ctx.globalAlpha = 0.06 + 0.7 * t;
              ctx.lineWidth = 0.6 + 1.8 * t;
              ctx.beginPath();
              ctx.moveTo(pos[l][i][0], pos[l][i][1]);
              ctx.lineTo(pos[l + 1][j][0], pos[l + 1][j][1]);
              ctx.stroke();
            }
          }
        }
        ctx.restore();

        /* 神经元 */
        for (l = 0; l < nL; l++) {
          var cnt2 = sizes[l];
          var rN = cnt2 >= 7 ? 5.5 : (cnt2 >= 5 ? 6.5 : 8);
          ctx.save();
          for (j = 0; j < pos[l].length; j++) {
            ctx.beginPath();
            ctx.fillStyle = "rgba(76,125,255,0.22)";
            ctx.strokeStyle = P.primary;
            ctx.lineWidth = 1.5;
            ctx.arc(pos[l][j][0], pos[l][j][1], rN, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
          ctx.restore();
        }

        /* 层标签 */
        ctx.save();
        ctx.font = "10px ui-monospace, Consolas, monospace";
        ctx.fillStyle = P.muted;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        for (l = 0; l < nL; l++) {
          var lab;
          if (l === 0) lab = "输入 " + sizes[l];
          else if (l === nL - 1) lab = "输出 " + sizes[l];
          else lab = "隐藏" + l + " " + sizes[l];
          ctx.fillText(lab, cols[l], h - padB + 8);
        }
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText("线色：青=w>0　紫=w<0", w - 14, 14);
        ctx.restore();
      }

      /* ================= 启动 ================= */
      makePane(paneLeft, "DECISION SURFACE", drawDecision);
      makePane(paneLoss, "LOSS", drawLoss);
      makePane(paneNet, "NETWORK", drawNet);

      reset();
      redraw();

      /* 单一 RAF 循环驱动训练：每帧 6 步 */
      LAB.loop(function () {
        if (!running) return;
        for (var i = 0; i < 6; i++) step();
        redraw();
      });
    },
  });
})();
