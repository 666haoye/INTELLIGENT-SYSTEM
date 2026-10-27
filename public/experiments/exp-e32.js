/* e32 · 长期依赖：RNN 的梯度通路 vs LSTM 的细胞状态 — 10.7 长期依赖的挑战 · 10.10 门控RNN · p343 · 配套设计 */
(function () {
  "use strict";
  var P = LAB.palette;

  /* ================= 数值内核（确定性可视化，不做训练竞赛） ================= */
  var H = 24;                       /* 隐藏维度 */
  var SEED_W = 30546;               /* 循环矩阵（种子经自检筛选：默认衰减 + ρ=3 爆炸同时成立） */
  var SEED_X = 32002;               /* 输入向量 w_x */
  var SEED_V = 33001;               /* 反向初始方向 v */
  var SEED_F = 32004;               /* 遗忘门抖动 */

  /* y = W·x */
  function mul(W, x) {
    var n = W.length, y = new Array(n), i, j, s, row;
    for (i = 0; i < n; i++) {
      s = 0;
      row = W[i];
      for (j = 0; j < n; j++) s += row[j] * x[j];
      y[i] = s;
    }
    return y;
  }

  /* y = Wᵀ·x */
  function mulT(W, x) {
    var n = W.length, y = new Array(n), i, j, row, xi;
    for (j = 0; j < n; j++) y[j] = 0;
    for (i = 0; i < n; i++) {
      row = W[i];
      xi = x[i];
      for (j = 0; j < n; j++) y[j] += row[j] * xi;
    }
    return y;
  }

  function norm(x) {
    var s = 0, i;
    for (i = 0; i < x.length; i++) s += x[i] * x[i];
    return Math.sqrt(s);
  }

  /* 幂迭代 40 次估计谱范数，随后整体缩放使谱范数等于 rho */
  function spectralNormalize(W, rho) {
    var n = W.length, r = LAB.rng(SEED_W + 7), v = [], i, k, u, w, nw, nv, sigma;
    for (i = 0; i < n; i++) v.push(r.gauss());
    nv = norm(v);
    for (i = 0; i < n; i++) v[i] /= nv;
    sigma = 1;
    for (k = 0; k < 40; k++) {
      u = mul(W, v);
      w = mulT(W, u);
      nw = norm(w);
      if (nw === 0) break;
      for (i = 0; i < n; i++) v[i] = w[i] / nw;
      sigma = Math.sqrt(nw);        /* ‖v‖=1 时 ‖WᵀWv‖ → λ_max */
    }
    var s = rho / sigma;
    for (i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) W[i][j] *= s;
    }
  }

  /* 正向 h_t = tanh(W·h_{t−1} + w_x)，返回 h_1..h_T */
  function forward(W, wx, T) {
    var hs = [], h = [], i, t, y;
    for (i = 0; i < H; i++) h[i] = 0;
    for (t = 0; t < T; t++) {
      y = mul(W, h);
      for (i = 0; i < H; i++) h[i] = Math.tanh(y[i] + wx[i]);
      hs.push(h.slice());
    }
    return hs;
  }

  /* 反向 v ← Wᵀ((1 − h²) ⊙ v)，返回每步 log₁₀‖v‖（长度 T+1，含步 0 的 0） */
  function backtrack(W, hs, T) {
    var r = LAB.rng(SEED_V), v = [], i, k, nv, h, u;
    for (i = 0; i < H; i++) v.push(r.gauss());
    nv = norm(v);
    for (i = 0; i < H; i++) v[i] /= nv;
    var logs = [0];
    for (k = 0; k < T; k++) {
      h = hs[T - 1 - k];           /* 从 h_T 倒着回传，与 BPTT 同向 */
      u = new Array(H);
      for (i = 0; i < H; i++) u[i] = (1 - h[i] * h[i]) * v[i];
      v = mulT(W, u);
      nv = norm(v);
      logs.push(Math.log10(Math.max(nv, 1e-30)));  /* 防 log10 下溢 */
    }
    return logs;
  }

  /* LSTM 细胞状态主通路：acc *= clamp(fg ± 0.015, 0.01, 1)，返回每步 log₁₀acc */
  function cellStatePath(fg, T) {
    var r = LAB.rng(SEED_F), acc = 1, logs = [0], k, f;
    for (k = 0; k < T; k++) {
      f = fg + (r() * 2 - 1) * 0.015;
      if (f > 1) f = 1;
      if (f < 0.01) f = 0.01;
      acc *= f;
      logs.push(Math.log10(Math.max(acc, 1e-30)));  /* 防 log10 下溢 */
    }
    return logs;
  }

  /* 科学计数：1.10e-4 / 1.85e+3 */
  function sci(x) {
    if (!(x > 0)) return "0";
    var e = Math.floor(Math.log10(x));
    var m = x / Math.pow(10, e);
    if (m >= 9.9995) { m /= 10; e += 1; }
    return m.toFixed(2) + "e" + (e >= 0 ? "+" : "") + e;
  }

  LAB.register("e32", {
    title: "长期依赖：RNN 的梯度通路 vs LSTM 的细胞状态",
    build: function (app) {
      var ui = LAB.shell(app, {
        id: "E32",
        title: "长期依赖：RNN 的梯度通路 vs LSTM 的细胞状态",
        source: "10.7 长期依赖的挑战 · 10.10 门控RNN · 印刷页 P.343 · 配套设计",
        tag: "配套设计",
        purpose: "看两条曲线：RNN 的对数梯度范数一路俯冲，LSTM 基本水平。",
        conclusion:
          "把 ρ 调到 2 以上，RNN 会掉头向上梯度爆炸——消失与爆炸来自同一串连乘，只是模长方向相反，对策也相反（消失靠门控与跳跃连接，爆炸靠梯度裁剪）。把 f 调到 0.7，LSTM 也会俯冲：可见「遗忘门初始化接近 1」才是 LSTM 能记住长序列的关键。注：这里画的是细胞状态那条主通路，LSTM 另有经过输入门与输出门的旁路，但决定长期依赖能否学到的是这条。",
        acceptance:
          "T=30、ρ=1.0、f=0.95：RNN 残留约 1.1e-4（< 1e-3）、LSTM 残留约 2.1e-1（> 1e-1）、倍数约 1.85e+3（> 100）；ρ=3.0 时 RNN 残留 > 1（爆炸）；f=0.7 时 LSTM 残留 < 1e-3。",
        metricLabels: ["RNN 残留", "LSTM 残留", "倍数 (LSTM÷RNN)", "遗忘门 f"],
      });

      var T = 30, rho = 1.0, fg = 0.95;
      var rnnLog = [0], lstmLog = [0];

      ui.control(LAB.slider({
        label: "回传步数 T", min: 5, max: 60, step: 5, value: 30,
        fmt: function (v) { return String(v); },
        onInput: function (v) { T = v; recompute(); },
      }));
      ui.control(LAB.slider({
        label: "RNN 循环矩阵谱半径 ρ", min: 0.5, max: 4.0, step: 0.05, value: 1.0,
        fmt: function (v) { return v.toFixed(2); },
        onInput: function (v) { rho = v; recompute(); },
      }));
      ui.control(LAB.slider({
        label: "LSTM 遗忘门 f", min: 0.5, max: 1.0, step: 0.01, value: 0.95,
        fmt: function (v) { return v.toFixed(2); },
        onInput: function (v) { fg = v; recompute(); },
      }));

      var cv = LAB.fitCanvas(document.createElement("canvas"), draw);
      ui.stage.appendChild(cv.canvas);

      /* 每次重算都重新播种：同一参数组合结果确定可复现 */
      function recompute() {
        var rW = LAB.rng(SEED_W), W = [], i, j, row, sc = 1 / Math.sqrt(H);
        for (i = 0; i < H; i++) {
          row = new Array(H);
          for (j = 0; j < H; j++) row[j] = rW.gauss() * sc;
          W.push(row);
        }
        spectralNormalize(W, rho);
        var rX = LAB.rng(SEED_X), wx = new Array(H);
        for (i = 0; i < H; i++) wx[i] = rX.gauss() * 0.6;
        var hs = forward(W, wx, T);
        rnnLog = backtrack(W, hs, T);
        lstmLog = cellStatePath(fg, T);
        draw();
      }

      function draw() {
        var wpx = cv.canvas.clientWidth, hpx = cv.canvas.clientHeight;
        if (!wpx || !hpx) return;
        var ctx = cv.ctx;
        ctx.clearRect(0, 0, wpx, hpx);

        /* 纵轴：上限 1，下限取两条曲线最小值向下取整，钳制到 -12 防下溢黑屏 */
        var minLog = 0, k;
        for (k = 0; k <= T; k++) {
          if (rnnLog[k] < minLog) minLog = rnnLog[k];
          if (lstmLog[k] < minLog) minLog = lstmLog[k];
        }
        var y0 = Math.floor(minLog);
        if (y0 < -12) y0 = -12;
        if (y0 > -1) y0 = -1;

        var padL = 54, padR = 14, padT = 16, padB = 36;
        var pw = wpx - padL - padR, ph = hpx - padT - padB;
        if (pw < 40 || ph < 40) return;
        var m = LAB.plotMap(padL, padT, pw, ph, [0, T], [y0, 1]);

        /* 横轴整数刻度 */
        var stepX = Math.max(1, Math.ceil(T / 6)), xt = [];
        for (k = 0; k <= T; k += stepX) xt.push(k);
        if (xt[xt.length - 1] !== T) xt.push(T);
        /* 纵轴整数 log 刻度 */
        var stepY = Math.max(1, Math.ceil((1 - y0) / 6)), yt = [];
        for (k = 1; k > y0; k -= stepY) yt.push(k);
        if (yt[yt.length - 1] !== y0) yt.push(y0);

        LAB.axes(ctx, m, {
          xticks: xt, yticks: yt,
          xfmt: function (t) { return String(Math.round(t)); },
          yfmt: function (t) { return String(Math.round(t)); },
          xlab: "回传步数", ylab: "log₁₀ 梯度范数",
        });

        var rnnPts = [], lstmPts = [];
        for (k = 0; k <= T; k++) {
          var rv = Math.max(y0, Math.min(1, rnnLog[k]));
          var lv = Math.max(y0, Math.min(1, lstmLog[k]));
          rnnPts.push([m.x(k), m.y(rv)]);
          lstmPts.push([m.x(k), m.y(lv)]);
        }
        LAB.polyline(ctx, rnnPts, P.fail, 2);
        LAB.polyline(ctx, lstmPts, P.cyan, 2);

        LAB.legend(ctx, [
          { color: P.fail, label: "RNN（tanh 反向连乘）" },
          { color: P.cyan, label: "LSTM（细胞状态 · 遗忘门连乘）" },
        ], padL + 12, padT + 12);

        var rr = Math.pow(10, rnnLog[T]);
        var lr = Math.pow(10, lstmLog[T]);
        ui.metrics.set(0, sci(rr), rr > 1 ? "is-fail" : "");
        ui.metrics.set(1, sci(lr));
        ui.metrics.set(2, sci(lr / rr), "is-hot");
        ui.metrics.set(3, fg.toFixed(2));
      }

      LAB.loop(function () { /* 确定性可视化：空转，参数变化即重算 */ });
      recompute();
    },
  });
})();
