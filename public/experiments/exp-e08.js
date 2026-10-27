/* e08 · PCA 降维与重建 — 2.12 实例：主成分分析 · 印刷页 P.42 · 配套设计 */
(function () {
  "use strict";
  var P = LAB.palette;

  LAB.register("e08", {
    title: "PCA 降维与重建",
    build: function (app) {
      var ui = LAB.shell(app, {
        id: "E08",
        title: "PCA 降维与重建",
        source: "2.12 实例：主成分分析 · 印刷页 P.42 · 配套设计",
        tag: "配套设计",
        purpose: "看投影—重建的误差线，以及保留方差比例随 k 如何变化。",
        conclusion:
          "k=0 时全部塌到中心；k=1 时误差线全垂直于第一主成分；k=2 时误差为 0。相关越强，丢掉第二主成分的代价越小。",
        acceptance: "k=2 时重建误差 < 1e-9 且保留方差 = 100%；k=0 时重建 RMSE 显著更大（约 1.97）。",
        metricLabels: ["保留方差比例", "重建 RMSE", "λ₁", "λ₂"],
      });

      var k = 1, corr = 0.85, n = 200;

      ui.control(LAB.segment({
        label: "保留主成分数 k",
        value: 1,
        options: [
          { value: 0, label: "k = 0" },
          { value: 1, label: "k = 1" },
          { value: 2, label: "k = 2" },
        ],
        onChange: function (v) { k = v; dirty = true; },
      }));
      ui.control(LAB.slider({
        label: "两维相关强度 corr", min: 0.2, max: 0.98, step: 0.02, value: 0.85,
        fmt: function (v) { return v.toFixed(2); },
        onInput: function (v) { corr = v; dirty = true; },
      }));
      ui.control(LAB.slider({
        label: "样本数 n", min: 60, max: 400, step: 20, value: 200,
        fmt: function (v) { return String(v); },
        onInput: function (v) { n = v; dirty = true; },
      }));

      var state = null;
      var dirty = true;

      /* 二维相关高斯 → 去均值协方差 → 2×2 解析特征分解 → 投影重建 */
      function compute() {
        var r = LAB.rng(8080);
        var pts = [];
        var mx = 0, my = 0, i;
        for (i = 0; i < n; i++) {
          var a = r.gauss();
          var b = r.gauss();
          var x = a * 1.4;
          var y = (corr * a + Math.sqrt(1 - corr * corr) * b) * 1.4;
          pts.push([x, y]);
          mx += x;
          my += y;
        }
        mx /= n;
        my /= n;

        var cxx = 0, cyy = 0, cxy = 0;
        for (i = 0; i < n; i++) {
          var dx = pts[i][0] - mx;
          var dy = pts[i][1] - my;
          cxx += dx * dx;
          cyy += dy * dy;
          cxy += dx * dy;
        }
        cxx /= n;
        cyy /= n;
        cxy /= n;

        var tr = cxx + cyy;
        var det = cxx * cyy - cxy * cxy;
        var disc = Math.sqrt(Math.max((tr / 2) * (tr / 2) - det, 0));
        var l1 = tr / 2 + disc;
        var l2 = tr / 2 - disc;

        /* v₁ ∝ [cxy, λ₁−cxx] 归一化；退化时取 [1,0] */
        var v1x = cxy, v1y = l1 - cxx;
        var vn = Math.sqrt(v1x * v1x + v1y * v1y);
        if (vn < 1e-12) { v1x = 1; v1y = 0; vn = 1; }
        v1x /= vn;
        v1y /= vn;
        var v2x = -v1y, v2y = v1x;

        var rec = [];
        var sse = 0;
        for (i = 0; i < n; i++) {
          var ddx = pts[i][0] - mx;
          var ddy = pts[i][1] - my;
          var s1 = ddx * v1x + ddy * v1y;
          var s2 = ddx * v2x + ddy * v2y;
          var rx = mx + (k >= 1 ? s1 * v1x : 0) + (k >= 2 ? s2 * v2x : 0);
          var ry = my + (k >= 1 ? s1 * v1y : 0) + (k >= 2 ? s2 * v2y : 0);
          rec.push([rx, ry]);
          var ex = pts[i][0] - rx;
          var ey = pts[i][1] - ry;
          sse += ex * ex + ey * ey;
        }
        var rmse = Math.sqrt(sse / n);

        var kept = (k >= 1 ? l1 : 0) + (k >= 2 ? l2 : 0);
        var ratio = (l1 + l2) > 0 ? kept / (l1 + l2) : 0;

        state = {
          pts: pts, rec: rec, mean: [mx, my],
          v1: [v1x, v1y], v2: [v2x, v2y],
          l1: l1, l2: l2, rmse: rmse, ratio: ratio,
        };
      }

      /* 过均值、沿方向 v 的直线裁剪到 ±4.6 视窗，返回两端点 */
      function viewSegment(mx, my, vx, vy) {
        var lim = 4.6;
        var t0 = -1e9, t1 = 1e9, m, v, ta, tb, tmp;
        var pairs = [[mx, vx], [my, vy]];
        for (var i = 0; i < 2; i++) {
          m = pairs[i][0];
          v = pairs[i][1];
          if (Math.abs(v) < 1e-12) continue;
          ta = (-lim - m) / v;
          tb = (lim - m) / v;
          if (ta > tb) { tmp = ta; ta = tb; tb = tmp; }
          if (ta > t0) t0 = ta;
          if (tb < t1) t1 = tb;
        }
        if (t0 > t1) return null;
        return [[mx + t0 * vx, my + t0 * vy], [mx + t1 * vx, my + t1 * vy]];
      }

      var cv = LAB.fitCanvas(document.createElement("canvas"), draw);
      ui.stage.appendChild(cv.canvas);

      function draw() {
        var wpx = cv.canvas.clientWidth, hpx = cv.canvas.clientHeight;
        if (!wpx || !hpx) return;
        var ctx = cv.ctx;
        ctx.clearRect(0, 0, wpx, hpx);
        if (!state) return;

        var pad = 46;
        var side = Math.min(wpx - pad * 2, hpx - pad * 1.6);
        var ox = (wpx - side) / 2, oy = (hpx - side) / 2 - 6;
        var m = LAB.plotMap(ox, oy, side, side, [-4.6, 4.6], [-4.6, 4.6]);
        LAB.axes(ctx, m, { xlab: "x₁", ylab: "x₂" });

        /* 第一主成分青实线，第二主成分紫虚线 */
        var mx = state.mean[0], my = state.mean[1];
        var seg1 = viewSegment(mx, my, state.v1[0], state.v1[1]);
        if (seg1) {
          LAB.polyline(ctx, [[m.x(seg1[0][0]), m.y(seg1[0][1])], [m.x(seg1[1][0]), m.y(seg1[1][1])]], P.cyan, 2);
        }
        var seg2 = viewSegment(mx, my, state.v2[0], state.v2[1]);
        if (seg2) {
          LAB.polyline(ctx, [[m.x(seg2[0][0]), m.y(seg2[0][1])], [m.x(seg2[1][0]), m.y(seg2[1][1])]], P.accent, 2, [6, 4]);
        }

        /* 误差线：原始点 → 重建点 */
        ctx.save();
        ctx.strokeStyle = "rgba(255,120,120,.42)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var i = 0; i < state.pts.length; i++) {
          ctx.moveTo(m.x(state.pts[i][0]), m.y(state.pts[i][1]));
          ctx.lineTo(m.x(state.rec[i][0]), m.y(state.rec[i][1]));
        }
        ctx.stroke();
        ctx.restore();

        /* 重建点青、原始点蓝 */
        for (i = 0; i < state.rec.length; i++) {
          LAB.dot(ctx, m.x(state.rec[i][0]), m.y(state.rec[i][1]), 2.5, P.cyan);
        }
        for (i = 0; i < state.pts.length; i++) {
          LAB.dot(ctx, m.x(state.pts[i][0]), m.y(state.pts[i][1]), 2.5, P.primary);
        }

        LAB.legend(ctx, [
          { color: P.primary, label: "原始点" },
          { color: P.cyan, label: "重建点" },
          { color: P.cyan, label: "第一主成分 v₁" },
          { color: P.accent, label: "第二主成分 v₂" },
          { color: "rgba(255,120,120,.8)", label: "误差线" },
        ], 14, 16);

        ui.metrics.set(0, (state.ratio * 100).toFixed(1) + "%",
          k === 2 ? "is-pass" : (state.ratio >= 0.9 ? "is-hot" : ""));
        ui.metrics.set(1, state.rmse.toFixed(4), k === 2 ? "is-pass" : "");
        ui.metrics.set(2, state.l1.toFixed(3));
        ui.metrics.set(3, state.l2.toFixed(3));
      }

      LAB.loop(function () {
        if (!dirty) return;
        dirty = false;
        compute();
        draw();
      });

      compute();
      draw();
    },
  });
})();
