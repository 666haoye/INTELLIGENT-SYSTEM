/* e33 · 极小数据集上的过拟合实验 — 11.5 调试策略 · 印刷页 P.372 · 教材明文要求 */
(function () {
  "use strict";
  var P = LAB.palette;

  LAB.register("e33", {
    title: "极小数据集上的过拟合实验",
    build: function (app) {
      var ui = LAB.shell(app, {
        id: "E33",
        title: "极小数据集上的过拟合实验",
        source: "11.5 调试策略 · 印刷页 P.372 · 教材明文要求",
        tag: "教材明文要求",
        required: true,
        purpose:
          "教材原文「拟合极小的数据集」——如果连一个极小数据集都拟合不了，「很有可能是由于软件错误阻止训练集上的成功优化」。训不到 100% 就说明代码有 bug——打开注入的 bug 复现这个结论。",
        conclusion:
          "教材 p372 原文：如果连一个极小数据集都拟合不了，「很有可能是由于软件错误阻止训练集上的成功优化」。开启 bug 后偏置按 b ← b − α 更新（正是书里的例子），准确率卡住上不去——这条测试就是这么用的。",
        acceptance:
          "bug 关闭时 400 步内准确率达到 100%（约第 170 步）；bug 开启时 400 步内达不到（停在 65% 左右）。",
        metricLabels: ["当前准确率", "历史最高", "首次 100% 步数", "迭代步数"],
      });

      /* ================= 状态 ================= */
      var n = 20;          /* 样本数（slider 4–40 步长 2，默认 20） */
      var bug = false;     /* 注入 bug：偏置更新漏掉梯度 */
      var lr = 0.5;
      var H = 16;          /* 隐层数 [2,16,1] */
      var X = [], Y = [];
      var W1 = new Array(2 * H), b1 = new Array(H), W2 = new Array(H), b2 = 0;
      var steps = 0, acc = 0, best = 0, first100 = -1;
      var hist = [];       /* 每步训练准确率历史（hist[0] = 第 0 步） */
      var running = true;

      /* ================= 控件 ================= */
      ui.control(LAB.slider({
        label: "样本数 n", min: 4, max: 40, step: 2, value: 20,
        fmt: function (v) { return String(v); },
        onInput: function (v) { n = v; reset(); draw(); },
      }));
      ui.control(LAB.toggle({
        label: "注入 bug（偏置更新漏掉梯度）",
        value: false,
        onChange: function (v) { bug = v; reset(); draw(); },
      }));
      var runBtn = LAB.btn("暂停", function () {
        running = !running;
        runBtn.textContent = running ? "暂停" : "运行";
      }, true);
      ui.control(runBtn);
      ui.control(LAB.btn("单步", function () {
        running = false;
        runBtn.textContent = "运行";
        train();
        draw();
      }));
      ui.control(LAB.btn("重置", function () { reset(); draw(); }));

      /* ================= 数据：n 个 [−1,1]² 点，圆边界线性不可分 ================= */
      /* 固定种子派生：改 n 用 33000+n 重建点集，结果可复现 */
      function makeData() {
        var r = LAB.rng(33000 + n);
        X = [];
        Y = [];
        for (var i = 0; i < n; i++) {
          var x = r() * 2 - 1;
          var y = r() * 2 - 1;
          X.push([x, y]);
          Y.push(x * x + y * y > 0.45 ? 1 : 0);
        }
      }

      /* ================= 网络 [2,16,1]：relu / sigmoid / 交叉熵 ================= */
      function forward(x) {
        var h = new Array(H), j;
        for (j = 0; j < H; j++) {
          var z = b1[j] + W1[j * 2] * x[0] + W1[j * 2 + 1] * x[1];
          h[j] = z > 0 ? z : 0;                 /* 隐藏层 relu */
        }
        var z2 = b2;
        for (j = 0; j < H; j++) z2 += W2[j] * h[j];
        var p = z2 >= 0                         /* 输出层 sigmoid（数值稳定） */
          ? 1 / (1 + Math.exp(-z2))
          : Math.exp(z2) / (1 + Math.exp(z2));
        return { h: h, p: p };
      }

      function accuracy() {
        var ok = 0;
        for (var i = 0; i < n; i++) {
          var p = forward(X[i]).p;
          if ((p >= 0.5 ? 1 : 0) === Y[i]) ok++;
        }
        return ok / n;
      }

      /* 全批量梯度下降：先对 n 个样本取均值再更新（严禁求和更新） */
      function train() {
        var gW1 = new Array(2 * H), gb1 = new Array(H), gW2 = new Array(H), gb2 = 0;
        var j, i;
        for (j = 0; j < 2 * H; j++) gW1[j] = 0;
        for (j = 0; j < H; j++) { gb1[j] = 0; gW2[j] = 0; }

        for (i = 0; i < n; i++) {
          var f = forward(X[i]);
          var p = f.p, h = f.h;
          var d2 = p - Y[i];                    /* sigmoid + 交叉熵：dL/dz₂ = p − y */
          gb2 += d2;
          for (j = 0; j < H; j++) {
            gW2[j] += d2 * h[j];
            var d1 = h[j] > 0 ? d2 * W2[j] : 0; /* relu 导数 */
            gb1[j] += d1;
            gW1[j * 2] += d1 * X[i][0];
            gW1[j * 2 + 1] += d1 * X[i][1];
          }
        }

        /* 均值更新（除以 n）。bug 模式（教材 p371 原式）：
           权重 w −= lr·gw 正常更新，偏置按 b ← b − 0.5 常量递减、更新里没有梯度。
           隐层偏置被常量递减推到负无穷 → relu 全灭、权重冻结（学不动）；
           输出偏置仍按梯度收敛到类先验 → 准确率停在 65% 量级，永远到不了 100%。 */
        for (j = 0; j < H; j++) {
          W1[j * 2] -= (lr * gW1[j * 2]) / n;
          W1[j * 2 + 1] -= (lr * gW1[j * 2 + 1]) / n;
          W2[j] -= (lr * gW2[j]) / n;
          b1[j] = bug ? b1[j] - 0.5 : b1[j] - (lr * gb1[j]) / n;
        }
        b2 -= (lr * gb2) / n;

        steps++;
        record();
      }

      function record() {
        acc = accuracy();
        if (acc > best) best = acc;
        if (acc >= 1 && first100 < 0) first100 = steps;
        hist.push(acc);
      }

      /* n 或 bug 变化、重置按钮：重建数据 + 固定种子重初始化 + 重绘 */
      function reset() {
        makeData();
        var r = LAB.rng(3650);                  /* 权重高斯 × 0.7 固定初始化 */
        var j;
        for (j = 0; j < 2 * H; j++) W1[j] = r.gauss() * 0.7;
        for (j = 0; j < H; j++) { b1[j] = 0; W2[j] = r.gauss() * 0.7; }
        b2 = 0;
        steps = 0;
        best = 0;
        first100 = -1;
        acc = accuracy();
        best = acc;
        hist = [acc];
        running = true;
        runBtn.textContent = "暂停";
      }

      /* ================= 渲染：单画布，准确率历史折线 ================= */
      var cv = LAB.fitCanvas(document.createElement("canvas"), draw);
      ui.stage.appendChild(cv.canvas);

      function draw() {
        var wpx = cv.canvas.clientWidth, hpx = cv.canvas.clientHeight;
        if (!wpx || !hpx) return;
        var ctx = cv.ctx;
        ctx.clearRect(0, 0, wpx, hpx);          /* 唯一一次清屏（单面板） */

        var padL = 50, padR = 20, padT = 20, padB = 36;
        var pw = wpx - padL - padR, ph = hpx - padT - padB;
        if (pw < 80 || ph < 80) return;

        var xmax = Math.max(60, steps);         /* x 轴 0–max(60, 已跑步数) */
        var m = LAB.plotMap(padL, padT, pw, ph, [0, xmax], [0, 1.05]);
        LAB.axes(ctx, m, {
          xlab: "训练步数",
          ylab: "训练准确率",
          yticks: [0, 0.25, 0.5, 0.75, 1.0],
          yfmt: function (v) { return Math.round(v * 100) + "%"; },
          xfmt: function (v) { return String(Math.round(v)); },
        });

        /* 准确率历史折线（primary）——先画曲线，再压参考线，避免 100% 段盖住绿虚线 */
        var pts = [];
        for (var i = 0; i < hist.length; i++) pts.push([m.x(i), m.y(hist[i])]);
        LAB.polyline(ctx, pts, P.primary, 2);

        /* y = 1.0 的 100% 参考线（pass 绿虚线），坐标系标 "100%" */
        LAB.polyline(ctx, [[m.x(0), m.y(1)], [m.x(xmax), m.y(1)]], P.pass, 1.5, [6, 4]);
        ctx.save();
        ctx.fillStyle = P.pass;
        ctx.font = "11px ui-monospace, Consolas, monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText("100%", m.x(0) + 5, m.y(1) - 5);
        ctx.restore();

        /* 首次达到准确率 = 1.0 的步数：pass 绿点（标注放在线下方的空白区） */
        if (first100 >= 0) {
          var lx = m.x(first100);
          LAB.dot(ctx, lx, m.y(1), 4.5, P.pass);
          var flip = lx + 130 > wpx - padR;
          ctx.save();
          ctx.fillStyle = P.pass;
          ctx.font = "11px system-ui, sans-serif";
          ctx.textBaseline = "top";
          ctx.textAlign = flip ? "right" : "left";
          ctx.fillText("第 " + first100 + " 步达 100%", flip ? lx - 10 : lx + 10, m.y(1) + 6);
          ctx.restore();
        }

        /* 图例放左下：准确率历史最低 0.357，其下方始终是空白区，不会压到曲线 */
        LAB.legend(ctx, [
          { color: P.primary, label: "训练准确率" },
          { color: P.pass, label: "100% 参考线" },
        ], padL + 10, m.y(0) - 60);

        ui.metrics.set(0, (acc * 100).toFixed(1) + "%", acc >= 1 ? "pass" : "");
        ui.metrics.set(1, (best * 100).toFixed(1) + "%", best >= 1 ? "pass" : "");
        ui.metrics.set(2, first100 < 0 ? "—" : String(first100), first100 < 0 ? "" : "pass");
        ui.metrics.set(3, String(steps));
      }

      /* 单一 RAF 循环：每帧推进 4 步 */
      LAB.loop(function () {
        if (!running) return;
        for (var i = 0; i < 4; i++) train();
        draw();
      });

      reset();
      draw();
    },
  });
})();
