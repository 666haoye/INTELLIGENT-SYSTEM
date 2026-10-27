/* e11 · 感知机为什么学不会异或 — 6.1 实例：学习XOR · p148 · 配套设计 */
(function () {
  "use strict";
  var P = LAB.palette;

  LAB.register("e11", {
    title: "感知机为什么学不会异或",
    build: function (app) {
      var ui = LAB.shell(app, {
        id: "E11",
        title: "感知机为什么学不会异或",
        source: "6.1 实例：学习XOR · 印刷页 P.148 · 配套设计",
        tag: "配套设计",
        purpose: "看训练准确率卡在 75%、损失不再下降——这是「必须加隐藏层」的动机。",
        conclusion:
          "准确率封顶 75%（一条直线分不对 XOR 的第四个点）。加一层隐藏单元并保留非线性，就是 e12。",
        acceptance: "训练 600 步后准确率 ≤ 75%，loss 停在 0.693 附近。",
        metricLabels: ["迭代步数", "当前 loss", "训练准确率", "上限"],
      });

      /* XOR 四点各复制 10 份，共 40 样本 */
      var BASE = [
        [-1, -1, 0], [-1, 1, 1], [1, -1, 1], [1, 1, 0],
      ];
      var X = [], Y = [];
      BASE.forEach(function (p) {
        for (var i = 0; i < 10; i++) { X.push([p[0], p[1]]); Y.push(p[2]); }
      });

      var lrCtl = ui.control(LAB.slider({
        label: "学习率", min: 0.05, max: 1.6, step: 0.05, value: 0.5,
        fmt: function (v) { return v.toFixed(2); },
        onInput: function (v) { lr = v; },
      }));
      ui.control(LAB.segment({
        label: "激活函数", value: "sigmoid",
        options: [{ value: "sigmoid", label: "sigmoid" }, { value: "relu", label: "relu" }],
        onChange: function () { /* 无隐藏层时不生效，保留对照 */ },
      }));
      var runBtn = LAB.btn("暂停", function () { running = !running; runBtn.textContent = running ? "暂停" : "运行"; }, true);
      ui.control(runBtn);
      ui.control(LAB.btn("单步", function () { running = false; runBtn.textContent = "运行"; step(); draw(); }));
      ui.control(LAB.btn("重置", function () { reset(); draw(); }));

      var lr = 0.5, running = true, steps = 0, loss = NaN;
      var w = [0, 0], b = 0;

      function reset() {
        var r = LAB.rng(11001);
        w = [r.gauss() * 0.5, r.gauss() * 0.5];
        b = 0;
        steps = 0;
        loss = NaN;
        running = true;
        runBtn.textContent = "暂停";
      }

      function forward(x) {
        return 1 / (1 + Math.exp(-(w[0] * x[0] + w[1] * x[1] + b)));
      }

      /* 全批量梯度下降：先对样本取均值再更新 */
      function step() {
        var gw = [0, 0], gb = 0, sum = 0;
        for (var i = 0; i < X.length; i++) {
          var p = forward(X[i]);
          var d = p - Y[i];
          sum += -(Y[i] * Math.log(p + 1e-12) + (1 - Y[i]) * Math.log(1 - p + 1e-12));
          gw[0] += d * X[i][0];
          gw[1] += d * X[i][1];
          gb += d;
        }
        var n = X.length;
        w[0] -= lr * gw[0] / n;
        w[1] -= lr * gw[1] / n;
        b -= lr * gb / n;
        loss = sum / n;
        steps++;
      }

      function accuracy() {
        var ok = 0;
        for (var i = 0; i < X.length; i++) {
          var pred = forward(X[i]) >= 0.5 ? 1 : 0;
          if (pred === Y[i]) ok++;
        }
        return ok / X.length;
      }

      var cv = LAB.fitCanvas(document.createElement("canvas"), draw);
      ui.stage.appendChild(cv.canvas);

      function draw() {
        var wpx = cv.canvas.clientWidth, hpx = cv.canvas.clientHeight;
        if (!wpx || !hpx) return;
        var ctx = cv.ctx;
        ctx.clearRect(0, 0, wpx, hpx);

        var pad = 46;
        var side = Math.min(wpx - pad * 2, hpx - pad * 1.6);
        var ox = (wpx - side) / 2, oy = (hpx - side) / 2 - 6;
        var m = LAB.plotMap(ox, oy, side, side, [-1.4, 1.4], [-1.4, 1.4]);
        LAB.axes(ctx, m, { xlab: "x₁", ylab: "x₂" });

        /* 决策直线 w₁x + w₂y + b = 0 */
        var pts = [];
        if (Math.abs(w[1]) > 1e-9) {
          for (var i = 0; i <= 60; i++) {
            var x = -1.4 + (2.8 * i) / 60;
            pts.push([m.x(x), m.y(-(w[0] * x + b) / w[1])]);
          }
        } else if (Math.abs(w[0]) > 1e-9) {
          var xv = -b / w[0];
          pts = [[m.x(xv), m.y(-1.4)], [m.x(xv), m.y(1.4)]];
        }
        LAB.polyline(ctx, pts, P.cyan, 2);

        /* 四个大点（各类 10 个样本重合） */
        BASE.forEach(function (p) {
          var x = m.x(p[0]), y = m.y(p[1]);
          if (p[2] === 1) LAB.dot(ctx, x, y, 7, P.primary);
          else LAB.ring(ctx, x, y, 7, P.accent, 2.5);
          ctx.fillStyle = "#e8ecf8";
          ctx.font = "11px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(p[2]), x + (p[0] > 0 ? 18 : -18), y);
        });

        LAB.legend(ctx, [
          { color: P.primary, label: "正类（1）" },
          { color: P.accent, label: "负类（0）" },
          { color: P.cyan, label: "决策边界" },
        ], 14, 16);

        var acc = accuracy();
        ui.metrics.set(0, String(steps));
        ui.metrics.set(1, isNaN(loss) ? "—" : loss.toFixed(4), "is-hot");
        ui.metrics.set(2, (acc * 100).toFixed(1) + "%", acc > 0.751 ? "is-fail" : "");
        ui.metrics.set(3, "75%");
      }

      LAB.loop(function () {
        if (!running) return;
        for (var i = 0; i < 4; i++) step();
        draw();
      });

      reset();
      draw();
    },
  });
})();
