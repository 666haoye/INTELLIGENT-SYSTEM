/* 十个数字实验 · 共享运行时（纯原生，无外部依赖，file:// 可直接打开） */
window.LAB = (function () {
  "use strict";

  var registry = Object.create(null);

  /* ================= 随机数（固定种子，结果可复现） ================= */
  function rng(seed) {
    var a = seed >>> 0;
    var spare = null;
    var r = function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.gauss = function () {
      if (spare !== null) {
        var s = spare;
        spare = null;
        return s;
      }
      var u = 0, v = 0, sq = 0;
      do {
        u = r() * 2 - 1;
        v = r() * 2 - 1;
        sq = u * u + v * v;
      } while (sq === 0 || sq >= 1);
      var mul = Math.sqrt((-2 * Math.log(sq)) / sq);
      spare = v * mul;
      return u * mul;
    };
    r.int = function (n) { return Math.floor(r() * n); };
    return r;
  }

  /* ================= DOM ================= */
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function btn(label, onClick, primary) {
    var b = el("button", "lab-btn" + (primary ? " is-primary" : ""), label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  /* 滑块控件 */
  function slider(opts) {
    var field = el("div", "lab-field");
    var label = el("label", null, opts.label);
    var input = document.createElement("input");
    input.type = "range";
    input.min = String(opts.min);
    input.max = String(opts.max);
    input.step = String(opts.step);
    input.value = String(opts.value);
    input.setAttribute("aria-label", opts.label);
    var out = el("output");
    var fmt = opts.fmt || function (v) { return String(v); };
    function sync() { out.textContent = fmt(Number(input.value)); }
    input.addEventListener("input", function () {
      sync();
      opts.onInput(Number(input.value));
    });
    sync();
    field.appendChild(label);
    field.appendChild(input);
    field.appendChild(out);
    return { root: field, get: function () { return Number(input.value); } };
  }

  /* 单选组（数据集 / 激活函数等） */
  function segment(opts) {
    var field = el("div", "lab-field");
    if (opts.label) field.appendChild(el("span", "lab-field-label", opts.label));
    var group = el("div", "lab-seg");
    group.setAttribute("role", "group");
    if (opts.label) group.setAttribute("aria-label", opts.label);
    var current = opts.value;
    var buttons = [];
    opts.options.forEach(function (opt) {
      var b = el("button", null, opt.label);
      b.type = "button";
      b.addEventListener("click", function () {
        if (current === opt.value) return;
        current = opt.value;
        buttons.forEach(function (x) {
          x.btn.classList.toggle("is-on", x.value === current);
        });
        opts.onChange(current);
      });
      buttons.push({ btn: b, value: opt.value });
      if (opt.value === current) b.classList.add("is-on");
      group.appendChild(b);
    });
    field.appendChild(group);
    return { root: field, get: function () { return current; } };
  }

  /* 复选开关（注入 bug / Dropout 开关） */
  function toggle(opts) {
    var field = el("div", "lab-field");
    var id = "lab-tg-" + Math.random().toString(36).slice(2);
    var input = document.createElement("input");
    input.type = "checkbox";
    input.id = id;
    input.checked = !!opts.value;
    input.addEventListener("change", function () {
      opts.onChange(input.checked);
    });
    var label = el("label", "lab-field-label", opts.label);
    label.htmlFor = id;
    field.appendChild(input);
    field.appendChild(label);
    return { root: field, get: function () { return input.checked; } };
  }

  /* 指标行 */
  function metrics(host, labels) {
    var cells = labels.map(function (text) {
      var cell = el("div", "lab-metric");
      cell.appendChild(el("span", null, text));
      var value = el("b", null, "—");
      cell.appendChild(value);
      host.appendChild(cell);
      return value;
    });
    return {
      set: function (index, text, tone) {
        var node = cells[index];
        node.textContent = text;
        node.className = tone ? "is-" + tone : "";
      },
    };
  }

  /* ================= Canvas ================= */
  /* 按 devicePixelRatio 缩放（上限 2），尺寸变化自动重绘 */
  function fitCanvas(canvas, draw) {
    var ctx = canvas.getContext("2d");
    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = canvas.clientWidth;
      var h = canvas.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(w, h, ctx);
    }
    var ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    return { canvas: canvas, redraw: resize, ctx: ctx };
  }

  /* 坐标映射：xlim/ylim 为 [min,max]，返回像素坐标 */
  function plotMap(px, py, pw, ph, xlim, ylim) {
    var sx = pw / (xlim[1] - xlim[0]);
    var sy = ph / (ylim[1] - ylim[0]);
    return {
      x: function (v) { return px + (v - xlim[0]) * sx; },
      y: function (v) { return py + ph - (v - ylim[0]) * sy; },
      inv: function (pxv) { return xlim[0] + (pxv - px) / sx; },
      xlim: xlim,
      ylim: ylim,
    };
  }

  /* 画一套坐标框：刻度 + 网格 + 边框 */
  function axes(ctx, m, opts) {
    opts = opts || {};
    var xt = opts.xticks || ticks(m.xlim);
    var yt = opts.yticks || ticks(m.ylim);
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.fillStyle = "#93a1c4";
    ctx.lineWidth = 1;
    ctx.font = "10px ui-monospace, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    xt.forEach(function (t) {
      var x = Math.round(m.x(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, m.y(m.ylim[0]));
      ctx.lineTo(x, m.y(m.ylim[1]));
      ctx.stroke();
      ctx.fillText(opts.xfmt ? opts.xfmt(t) : String(t), x, m.y(m.ylim[0]) + 4);
    });
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    yt.forEach(function (t) {
      var y = Math.round(m.y(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(m.x(m.xlim[0]), y);
      ctx.lineTo(m.x(m.xlim[1]), y);
      ctx.stroke();
      ctx.fillText(opts.yfmt ? opts.yfmt(t) : String(t), m.x(m.xlim[0]) - 6, y);
    });
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.strokeRect(
      m.x(m.xlim[0]) + 0.5, m.y(m.ylim[1]) + 0.5,
      m.x(m.xlim[1]) - m.x(m.xlim[0]) - 1,
      m.y(m.ylim[0]) - m.y(m.ylim[1]) - 1
    );
    if (opts.xlab) {
      ctx.fillStyle = "#93a1c4";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(opts.xlab, (m.x(m.xlim[0]) + m.x(m.xlim[1])) / 2, m.y(m.ylim[0]) + 30);
    }
    if (opts.ylab) {
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(opts.ylab, m.x(m.xlim[0]) + 2, m.y(m.ylim[1]) - 1);
    }
    ctx.restore();
  }

  function ticks(lim) {
    var out = [];
    for (var i = 0; i <= 4; i++) out.push(lim[0] + ((lim[1] - lim[0]) * i) / 4);
    return out;
  }

  /* 折线（自动裁剪到画布） */
  function polyline(ctx, pts, color, width, dashed) {
    if (pts.length < 2) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, ctx.canvas.clientWidth, ctx.canvas.clientHeight);
    ctx.clip();
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 2;
    if (dashed) ctx.setLineDash(dashed);
    pts.forEach(function (p, i) {
      if (i === 0) ctx.moveTo(p[0], p[1]);
      else ctx.lineTo(p[0], p[1]);
    });
    ctx.stroke();
    ctx.restore();
  }

  function dot(ctx, x, y, r, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function ring(ctx, x, y, r, color, width) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /* 图例 */
  function legend(ctx, items, x, y) {
    ctx.save();
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    var cursor = y;
    items.forEach(function (it) {
      ctx.fillStyle = it.color;
      ctx.fillRect(x, cursor - 1.5, 14, 3);
      ctx.fillStyle = "#93a1c4";
      ctx.textAlign = "left";
      ctx.fillText(it.label, x + 20, cursor);
      cursor += 16;
    });
    ctx.restore();
  }

  /* ================= 单一 RAF 循环 ================= */
  /* step(dt, t)；页面隐藏自动暂停；返回 stop() */
  function loop(step) {
    var id = 0;
    var last = 0;
    var running = true;
    function frame(t) {
      if (!running) return;
      var dt = last ? Math.min((t - last) / 1000, 0.1) : 0.016;
      last = t;
      step(dt, t / 1000);
      id = window.requestAnimationFrame(frame);
    }
    function onVis() {
      if (document.hidden) {
        window.cancelAnimationFrame(id);
        last = 0;
      } else if (running) {
        id = window.requestAnimationFrame(frame);
      }
    }
    document.addEventListener("visibilitychange", onVis);
    id = window.requestAnimationFrame(frame);
    return function stop() {
      running = false;
      window.cancelAnimationFrame(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }

  /* ================= 页面骨架 ================= */
  /* 每个实验顶部标注：教材章节 · 印刷页码 · 「教材明文要求」或「配套设计」 */
  function shell(app, meta) {
    var root = el("div", "lab");
    var head = el("header", "lab-head");
    head.appendChild(el("div", "lab-id", meta.id));
    var titles = el("div", "lab-titles");
    var h1 = el("h1", null, meta.title);
    titles.appendChild(h1);
    titles.appendChild(el("p", "lab-source", meta.source));
    head.appendChild(titles);
    head.appendChild(
      el("span", "lab-tag" + (meta.required ? " is-required" : ""), meta.tag)
    );
    root.appendChild(head);

    var purpose = el("p", "lab-purpose");
    purpose.appendChild(el("b", null, "目的"));
    purpose.appendChild(document.createTextNode("　" + meta.purpose));
    root.appendChild(purpose);

    var controls = el("div", "lab-controls");
    root.appendChild(controls);

    var stage = el("div", "lab-stage");
    root.appendChild(stage);

    var metricRow = el("div", "lab-metrics");
    root.appendChild(metricRow);

    var notes = el("div", "lab-notes");
    var conclusion = el("p", null);
    conclusion.appendChild(el("b", null, "结论"));
    conclusion.appendChild(document.createTextNode(meta.conclusion));
    notes.appendChild(conclusion);
    var accept = el("p", "is-accept");
    accept.appendChild(el("b", null, "验收"));
    accept.appendChild(document.createTextNode(meta.acceptance));
    notes.appendChild(accept);
    root.appendChild(notes);

    app.appendChild(root);

    var watchers = [];
    function onChange(fn) { watchers.push(fn); }
    function fire() { watchers.forEach(function (fn) { fn(); }); }
    function control(ctl) {
      controls.appendChild(ctl.root || ctl);
      return ctl;
    }

    return {
      root: root,
      controls: controls,
      stage: stage,
      control: control,
      onChange: onChange,
      fire: fire,
      metrics: metrics(metricRow, meta.metricLabels),
    };
  }

  /* ================= 注册与启动 ================= */
  function register(id, def) { registry[id] = def; }

  function boot() {
    var app = document.getElementById("app");
    var id = app && app.getAttribute("data-exp");
    var def = id && registry[id];
    if (!def) {
      if (app) {
        app.textContent = id ? "未找到实验：" + id : "缺少 data-exp 属性";
      }
      return;
    }
    document.title = id.toUpperCase() + " · " + def.title + " · 实验沙盒";
    def.build(app);
    document.documentElement.setAttribute("data-lab-ready", "1");
  }

  return {
    rng: rng,
    el: el,
    btn: btn,
    slider: slider,
    segment: segment,
    toggle: toggle,
    fitCanvas: fitCanvas,
    plotMap: plotMap,
    axes: axes,
    polyline: polyline,
    dot: dot,
    ring: ring,
    legend: legend,
    loop: loop,
    shell: shell,
    register: register,
    boot: boot,
    palette: {
      primary: "#4c7dff",
      accent: "#a78bfa",
      cyan: "#22d3ee",
      pass: "#3ddc97",
      fail: "#ff6b6b",
      muted: "#93a1c4",
    },
  };
})();
