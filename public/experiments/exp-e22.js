/* e22 · 学习率敏感性扫描 — 8.3 基本算法 · p251 · 配套设计 */
(function () {
  "use strict";
  var P = LAB.palette;

  var N = 24;          /* 学习率个数 */
  var LO = -4, HI = 1; /* 横轴 log10(lr) 范围 */
  var W0 = 3;          /* 起点 (3, 3) */
  var DIVERGE = 1e12;  /* 发散判据：|w| 超过它或出现非有限值 */
  var MAX_TRAJ = 400;  /* 轨迹最多记录的点数 */

  /* 24 个学习率：1e-4 → 10 对数等分 */
  var LRS = [];
  for (var k = 0; k < N; k++) {
    LRS.push(Math.pow(10, LO + ((HI - LO) * k) / (N - 1)));
  }

  /* 紧凑数值：6.70e-2 / 4.25e-6；发散时返回「发散」 */
  function fmtSci(v) {
    if (typeof v !== "number" || !isFinite(v)) return "发散";
    return v.toExponential(2);
  }

  /* log10(最终损失)，夹到纵轴 [-6, 4] */
  function clampLog(loss) {
    if (!(loss > 0)) return -6;
    var lg = Math.log(loss) / Math.LN10;
    if (!isFinite(lg) || lg < -6) return -6;
    if (lg > 4) return 4;
    return lg;
  }

  LAB.register("e22", {
    title: "学习率敏感性扫描",
    build: function (app) {
      var ui = LAB.shell(app, {
        id: "E22",
        title: "学习率敏感性扫描",
        source: "8.3 基本算法 · 印刷页 P.251 · 配套设计",
        tag: "配套设计",
        purpose: "拿到那条典型的 U 形曲线——太小走不动，太大直接发散。",
        conclusion:
          "把条件数调大（碗更扁），可用学习率的范围明显变窄——这正是 4.2 节「病态条件」在优化里的直接后果。",
        acceptance: "能找到最优学习率（约 6.7e-2）；lr = 1e-4 时损失很大（约 6.5e+1）；lr = 10 时发散",
        metricLabels: ["最优学习率", "最优最终损失", "当前 lr", "当前损失"],
      });

      var cond = 20, steps = 100, pick = 12;
      var results = [], best = 0;

      /* 单个学习率：f(w)=0.5·(w₁²+cond·w₂²)，梯度下降 w₁−=lr·w₁、w₂−=lr·cond·w₂。
         返回最终损失、轨迹（起点+后续，最多 MAX_TRAJ 个点）与是否发散。 */
      function runOne(lr) {
        var w1 = W0, w2 = W0;
        var pts = [[w1, w2]];
        for (var s = 0; s < steps; s++) {
          w1 -= lr * w1;
          w2 -= lr * cond * w2;
          if (!isFinite(w1) || !isFinite(w2) ||
              Math.abs(w1) > DIVERGE || Math.abs(w2) > DIVERGE) {
            return { loss: NaN, pts: pts, diverged: true };
          }
          if (pts.length < MAX_TRAJ) pts.push([w1, w2]);
        }
        return { loss: 0.5 * (w1 * w1 + cond * w2 * w2), pts: pts, diverged: false };
      }

      /* 扫描 24 个学习率，取最终损失最小者为最优 */
      function scan() {
        results = [];
        best = -1;
        for (var i = 0; i < N; i++) {
          results.push(runOne(LRS[i]));
          var L = results[i].loss;
          if (isFinite(L) && (best < 0 || L < results[best].loss)) best = i;
        }
        if (best < 0) best = 0;
      }

      function updateMetrics() {
        if (!results.length) return;
        ui.metrics.set(0, fmtSci(LRS[best]), "");
        ui.metrics.set(1, fmtSci(results[best].loss), "");
        ui.metrics.set(2, fmtSci(LRS[pick]), "");
        var cur = results[pick];
        if (cur.diverged || !isFinite(cur.loss)) ui.metrics.set(3, "发散", "fail");
        else ui.metrics.set(3, fmtSci(cur.loss), "");
      }

      /* ---------- 左面板：U 形扫描曲线 ---------- */
      function drawSweep(w, h, ctx) {
        ctx.clearRect(0, 0, w, h);
        if (!results.length) return;

        var px = 46, py = 26;
        var pw = Math.max(30, w - 60), ph = Math.max(30, h - 70);
        var m = LAB.plotMap(px, py, pw, ph, [LO, HI], [-6, 4]);
        LAB.axes(ctx, m, {
          xticks: [-4, -3, -2, -1, 0, 1],
          yticks: [-6, -4, -2, 0, 2, 4],
          xfmt: function (t) { return "1e" + t; },
          yfmt: function (t) { return "1e" + t; },
          xlab: "log₁₀(学习率)",
          ylab: "log₁₀(最终损失)",
        });

        function X(i) { return m.x(LO + ((HI - LO) * i) / (N - 1)); }

        /* 主曲线：cyan 折线，发散点断开并钉在顶部（y=4）用红点标注 */
        var seg = [];
        for (var i = 0; i < N; i++) {
          var r = results[i];
          if (!isFinite(r.loss)) {
            if (seg.length > 1) LAB.polyline(ctx, seg, P.cyan, 2);
            seg = [];
            LAB.dot(ctx, X(i), m.y(4), 3.5, P.fail);
            continue;
          }
          seg.push([X(i), m.y(clampLog(r.loss))]);
        }
        if (seg.length > 1) LAB.polyline(ctx, seg, P.cyan, 2);

        /* 当前学习率：红实心点 + 红 ring 强调；发散时画在顶部 */
        var cur = results[pick];
        var cy = isFinite(cur.loss) ? m.y(clampLog(cur.loss)) : m.y(4);
        LAB.dot(ctx, X(pick), cy, 5, P.fail);
        LAB.ring(ctx, X(pick), cy, 8.5, P.fail, 1.5);

        /* 最优学习率：绿实心点（与当前重合时压在红点上，红 ring 仍标出当前） */
        if (isFinite(results[best].loss)) {
          LAB.dot(ctx, X(best), m.y(clampLog(results[best].loss)), 5.5, P.pass);
        }

        LAB.legend(ctx, [
          { color: P.cyan, label: "最终损失 U 形曲线" },
          { color: P.pass, label: "最优学习率" },
          { color: P.fail, label: "当前学习率" },
          { color: P.fail, label: "发散点（钉在顶部）" },
        ], px + 10, m.y(-6) - 76);
      }

      /* ---------- 右面板：当前学习率的下降轨迹 ---------- */
      function drawTraj(w, h, ctx) {
        ctx.clearRect(0, 0, w, h);
        if (!results.length) return;

        var side = Math.max(40, Math.min(w - 72, h - 78));
        var ox = (w - side) / 2, oy = (h - side) / 2 + 6;
        var m = LAB.plotMap(ox, oy, side, side, [-3.4, 3.4], [-3.4, 3.4]);
        LAB.axes(ctx, m, {
          xticks: [-3, -1.5, 0, 1.5, 3],
          yticks: [-3, -1.5, 0, 1.5, 3],
          xlab: "w₁",
          ylab: "w₂",
        });

        var r = results[pick];
        var pts = [];
        for (var i = 0; i < r.pts.length; i++) {
          pts.push([m.x(r.pts[i][0]), m.y(r.pts[i][1])]);
        }
        LAB.polyline(ctx, pts, P.primary, 2);
        LAB.ring(ctx, m.x(W0), m.y(W0), 5, "#ffffff", 2);
        var last = r.pts[r.pts.length - 1];
        if (Math.abs(last[0]) <= 3.4 && Math.abs(last[1]) <= 3.4) {
          LAB.dot(ctx, m.x(last[0]), m.y(last[1]), 5, P.cyan);
        }

        LAB.legend(ctx, [
          { color: P.primary, label: "梯度下降轨迹" },
          { color: "#ffffff", label: "起点 (3,3)" },
          { color: P.cyan, label: "终点" },
        ], ox + 8, oy + side - 58);

        ctx.save();
        ctx.font = "11px ui-monospace, Consolas, monospace";
        ctx.textBaseline = "top";
        ctx.fillStyle = P.muted;
        ctx.textAlign = "right";
        ctx.fillText("cond=" + cond + " · steps=" + steps, w - 12, 8);
        if (r.diverged) {
          ctx.fillStyle = P.fail;
          ctx.textAlign = "center";
          ctx.fillText("该学习率发散 · 轨迹中断", ox + side / 2, oy - 20);
        }
        ctx.restore();
      }

      var cvS = null, cvT = null;
      function refresh() {
        updateMetrics();
        if (cvS) cvS.redraw();
        if (cvT) cvT.redraw();
      }

      /* 左右双面板：各自独立 canvas、各自 clearRect（第二个面板不碰第一个） */
      var split = LAB.el("div", "lab-stage-split");
      split.style.gridTemplateColumns = "1fr 1fr";
      ui.stage.appendChild(split);

      function host(label) {
        var box = LAB.el("div", "lab-canvas-host");
        box.appendChild(LAB.el("div", "lab-pane-label", label));
        var canvas = document.createElement("canvas");
        box.appendChild(canvas);
        split.appendChild(box);
        return canvas;
      }

      scan();
      cvS = LAB.fitCanvas(host("SWEEP"), drawSweep);
      cvT = LAB.fitCanvas(host("TRAJECTORY"), drawTraj);

      ui.control(LAB.slider({
        label: "条件数（碗的扁平度）", min: 1, max: 60, step: 1, value: cond,
        fmt: function (v) { return String(v); },
        onInput: function (v) { cond = v; scan(); refresh(); },
      }));
      ui.control(LAB.slider({
        label: "每个学习率跑多少步", min: 20, max: 300, step: 10, value: steps,
        fmt: function (v) { return v + " 步"; },
        onInput: function (v) { steps = v; scan(); refresh(); },
      }));
      ui.control(LAB.slider({
        label: "看轨迹的学习率序号", min: 0, max: N - 1, step: 1, value: pick,
        fmt: function (v) { return v + " · " + fmtSci(LRS[v]); },
        onInput: function (v) { pick = v; refresh(); },
      }));

      /* 扫描是瞬时完成的（24 × ≤300 步标量迭代），无需在线训练循环 */
      LAB.loop(function () {});

      refresh();
    },
  });
})();
