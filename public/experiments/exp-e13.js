/* e13 · 反向传播梯度与有限差分对拍 — 11.5 调试策略 · 印刷页 P.373 · 教材明文要求 */
(function () {
  "use strict";

  LAB.register("e13", {
    title: "反向传播梯度与有限差分对拍",
    build: function (app) {
      var ui = LAB.shell(app, {
        id: "E13",
        title: "反向传播梯度与有限差分对拍",
        source: "11.5 调试策略 · 印刷页 P.373 · 教材明文要求",
        tag: "教材明文要求",
        required: true,
        purpose: "对拍误差小于 1e-6 才算实现正确；注入 bug 后误差立刻爆掉。",
        conclusion:
          "教材 p373 原文要求用有限差分验证梯度实现。关闭 bug 时相对误差应在 1e-9 量级；开启后某层梯度明显对不上——这正是这个测试存在的意义。",
        acceptance:
          "bug 关闭时最大相对误差 < 1e-6（应达 1e-9 量级）；bug 开启时 > 1e-3（约 2.2e-1）。",
        metricLabels: ["最大相对误差", "判定", "扰动 ε", "参数总数"],
      });

      /* 固定样本（教材要求对拍可复现）：x = [0.6, −0.35]，标签 y = 1 */
      var X = [0.6, -0.35];
      var Y = 1;

      /* [2,4,1] 网络：W1[4][2]=8 + b1[4] + W2[4]=4 + b2=1，共 17 个参数 */
      var W1 = new Array(8), b1 = new Array(4), W2 = new Array(4), b2 = [0];

      /* 扁平参数表（固定顺序，供逐参数差分与命名） */
      var refs = [], names = [];
      (function () {
        var j, i;
        for (j = 0; j < 4; j++) {
          for (i = 0; i < 2; i++) {
            names.push("W1[" + j + "][" + i + "]");
            refs.push({ arr: W1, idx: j * 2 + i });
          }
        }
        for (j = 0; j < 4; j++) {
          names.push("b1[" + j + "]");
          refs.push({ arr: b1, idx: j });
        }
        for (j = 0; j < 4; j++) {
          names.push("W2[" + j + "][0]");
          refs.push({ arr: W2, idx: j });
        }
        names.push("b2");
        refs.push({ arr: b2, idx: 0 });
      })();

      var eps = 1e-4;
      var bug = false;
      var rows = [];
      var maxRel = 0;

      function initParams() {
        var r = LAB.rng(13007);
        var j, i;
        for (i = 0; i < 8; i++) W1[i] = r.gauss() * 0.5;
        for (j = 0; j < 4; j++) b1[j] = r.gauss() * 0.5;
        for (j = 0; j < 4; j++) W2[j] = r.gauss() * 0.5;
        b2[0] = r.gauss() * 0.5;
      }

      /* 前向：隐藏 tanh、输出 sigmoid */
      function forward() {
        var h = new Array(4), j;
        for (j = 0; j < 4; j++) {
          h[j] = Math.tanh(W1[j * 2] * X[0] + W1[j * 2 + 1] * X[1] + b1[j]);
        }
        var z = b2[0];
        for (j = 0; j < 4; j++) z += W2[j] * h[j];
        var p = 1 / (1 + Math.exp(-z));
        return { h: h, p: p };
      }

      /* 交叉熵损失（对单个固定样本） */
      function loss() {
        var p = forward().p;
        if (p < 1e-12) p = 1e-12;
        if (p > 1 - 1e-12) p = 1 - 1e-12;
        return -(Y * Math.log(p) + (1 - Y) * Math.log(1 - p));
      }

      /* 解析梯度：标准反向传播（bug 开启时回传到第 1 层漏乘 tanh 导数） */
      function analyticGrad() {
        var f = forward(), h = f.h, p = f.p;
        var d2 = p - Y; /* sigmoid + 交叉熵合并：dL/dz2 = p − y */
        var g = new Array(17);
        var j;
        for (j = 0; j < 4; j++) g[12 + j] = d2 * h[j]; /* W2 */
        g[16] = d2; /* b2 */
        for (j = 0; j < 4; j++) {
          var dh = d2 * W2[j];
          var dact = bug ? 1 : 1 - h[j] * h[j]; /* bug：用 1 代替 dact（漏乘 tanh 导数） */
          var d1 = dh * dact;
          g[j * 2] = d1 * X[0]; /* W1 */
          g[j * 2 + 1] = d1 * X[1];
          g[8 + j] = d1; /* b1 */
        }
        return g;
      }

      /* 数值梯度：逐参数中心差分，扰动后必须还原 */
      function numericGrad(step) {
        var g = new Array(17);
        for (var k = 0; k < 17; k++) {
          var ref = refs[k];
          var orig = ref.arr[ref.idx];
          ref.arr[ref.idx] = orig + step;
          var lp = loss();
          ref.arr[ref.idx] = orig - step;
          var lm = loss();
          ref.arr[ref.idx] = orig; /* 还原 */
          g[k] = (lp - lm) / (2 * step);
        }
        return g;
      }

      function recompute() {
        var ga = analyticGrad();
        var gn = numericGrad(eps);
        rows = [];
        maxRel = 0;
        for (var k = 0; k < 17; k++) {
          var re =
            Math.abs(ga[k] - gn[k]) /
            Math.max(1e-8, Math.abs(ga[k]) + Math.abs(gn[k]));
          rows.push({ name: names[k], a: ga[k], n: gn[k], rel: re });
          if (re > maxRel) maxRel = re;
        }
      }

      function fmt(v) {
        return v.toExponential(6);
      }

      function draw() {
        var wrap = LAB.el("div", "lab-table-wrap");
        var table = LAB.el("table", "lab-table");
        var thead = document.createElement("thead");
        var htr = document.createElement("tr");
        ["参数", "解析梯度 (BP)", "数值梯度 (中心差分)", "相对误差"].forEach(function (t) {
          htr.appendChild(LAB.el("th", null, t));
        });
        thead.appendChild(htr);
        table.appendChild(thead);
        var tbody = document.createElement("tbody");
        for (var k = 0; k < 12; k++) {
          var r = rows[k];
          var tr = document.createElement("tr");
          tr.appendChild(LAB.el("td", null, r.name));
          tr.appendChild(LAB.el("td", null, fmt(r.a)));
          tr.appendChild(LAB.el("td", null, fmt(r.n)));
          tr.appendChild(
            LAB.el("td", r.rel < 1e-6 ? "is-ok" : "is-bad", r.rel.toExponential(2))
          );
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
        ui.stage.textContent = "";
        ui.stage.appendChild(wrap);
        ui.stage.appendChild(
          LAB.el("p", "lab-table-note", "仅列出前 12 / 17 个参数（全部 17 个参数均参与最大相对误差统计）")
        );

        var pass = maxRel < 1e-6;
        ui.metrics.set(0, maxRel.toExponential(2), pass ? "pass" : "fail");
        ui.metrics.set(1, pass ? "通过 ✓" : "不通过 ✗", pass ? "pass" : "fail");
        ui.metrics.set(2, eps.toExponential(0));
        ui.metrics.set(3, "17");
      }

      /* 控件：扰动 ε + bug 开关；变化时重算一次并重绘 */
      ui.control(
        LAB.segment({
          label: "扰动 ε",
          value: 1e-4,
          options: [
            { value: 1e-3, label: "1e-3" },
            { value: 1e-4, label: "1e-4" },
            { value: 1e-5, label: "1e-5" },
            { value: 1e-6, label: "1e-6" },
          ],
          onChange: function (v) {
            eps = v;
            recompute();
            draw();
          },
        })
      );
      ui.control(
        LAB.toggle({
          label: "注入 bug（回传到第 1 层漏乘 tanh 导数）",
          value: false,
          onChange: function (v) {
            bug = v;
            recompute();
            draw();
          },
        })
      );

      LAB.loop(function () {}); /* 无训练循环：本实验是静态对拍 */

      initParams();
      recompute();
      draw();
    },
  });
})();
