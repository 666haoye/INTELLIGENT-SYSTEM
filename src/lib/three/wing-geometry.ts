/* 蝴蝶的几何数据与采样。
 *
 * 路径 d 字符串逐字迁自旧的 src/components/Butterfly.tsx（:6-125 的常量，以及写在 JSX
 * 内联的 body / antenna / rays 路径），这样和改造前的画面可以逐条比对。
 * 节点插座（socket）已删：它的视觉职责由 node-rings.ts 的三层接口环接管。
 * 全部是设计像素坐标（1440×900），换算世界坐标由引用方用 design-space 完成。
 *
 * 不引 three：这里只做纯数学采样，能脱离浏览器直接跑数值校验。
 * 不用 SVGLoader：它要整份 XML 解析，且这些路径只用到 M/C/Q/H/V/Z 五种绝对命令，
 * 自己采样反而更短、更可控，也不用把几百行的 loader 打进单文件产物。
 */

export type Pt = [number, number];
export type Polyline = Pt[];

/**
 * 这些字符串只出现绝对命令（大写），旧 SVG 里没有相对坐标，所以解析器不实现小写分支。
 */
const PATH_TOKEN = /([MLCQHVZ])([^MLCQHVZ]*)/gi;

function evalCubic(from: Pt, c1: Pt, c2: Pt, to: Pt, divisions: number): Polyline {
  const out: Polyline = [];
  for (let i = 1; i <= divisions; i += 1) {
    const t = i / divisions;
    const mt = 1 - t;
    const a = mt * mt * mt;
    const b = 3 * mt * mt * t;
    const c = 3 * mt * t * t;
    const d = t * t * t;
    out.push([
      a * from[0] + b * c1[0] + c * c2[0] + d * to[0],
      a * from[1] + b * c1[1] + c * c2[1] + d * to[1],
    ]);
  }
  return out;
}

function evalQuad(from: Pt, c1: Pt, to: Pt, divisions: number): Polyline {
  return evalCubic(
    from,
    [from[0] + (2 / 3) * (c1[0] - from[0]), from[1] + (2 / 3) * (c1[1] - from[1])],
    [to[0] + (2 / 3) * (c1[0] - to[0]), to[1] + (2 / 3) * (c1[1] - to[1])],
    to,
    divisions,
  );
}

/** 按控制多边形长度决定细分密度：约每 5 设计像素一段。 */
function density(points: Pt[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return Math.max(6, Math.min(64, Math.round(length / 5)));
}

/**
 * d 字符串 → 若干条折线（每个 M 起一条新子路径）。
 * 子路径是否闭合由 Z 决定：闭合时把起点补到末尾，让最后一段曲线也画出来。
 */
export function parsePath(d: string): Polyline[] {
  const polys: Polyline[] = [];
  let current: Polyline | null = null;
  let start: Pt = [0, 0];
  let cursor: Pt = [0, 0];
  const numbers = (chunk: string) => chunk.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];

  for (const [, command, chunk] of d.matchAll(PATH_TOKEN)) {
    const args = numbers(chunk);
    const kind = command.toUpperCase();

    if (kind === "M") {
      if (current && current.length > 1) polys.push(current);
      start = [args[0], args[1]];
      cursor = start;
      current = [start];
      /* M 后面连续跟坐标对，SVG 语义等价于隐式 L */
      for (let i = 2; i + 1 < args.length; i += 2) {
        cursor = [args[i], args[i + 1]];
        current.push(cursor);
      }
      continue;
    }

    if (!current) continue;

    if (kind === "Z") {
      if (cursor[0] !== start[0] || cursor[1] !== start[1]) current.push(start);
      cursor = start;
      continue;
    }

    if (kind === "H") {
      for (const x of args) {
        cursor = [x, cursor[1]];
        current.push(cursor);
      }
      continue;
    }

    if (kind === "V") {
      for (const y of args) {
        cursor = [cursor[0], y];
        current.push(cursor);
      }
      continue;
    }

    if (kind === "L") {
      for (let i = 0; i + 1 < args.length; i += 2) {
        cursor = [args[i], args[i + 1]];
        current.push(cursor);
      }
      continue;
    }

    if (kind === "C") {
      for (let i = 0; i + 5 < args.length; i += 6) {
        const from = cursor;
        const c1: Pt = [args[i], args[i + 1]];
        const c2: Pt = [args[i + 2], args[i + 3]];
        const to: Pt = [args[i + 4], args[i + 5]];
        current.push(...evalCubic(from, c1, c2, to, density([from, c1, c2, to])));
        cursor = to;
      }
      continue;
    }

    if (kind === "Q") {
      for (let i = 0; i + 3 < args.length; i += 4) {
        const from = cursor;
        const c1: Pt = [args[i], args[i + 1]];
        const to: Pt = [args[i + 2], args[i + 3]];
        current.push(...evalQuad(from, c1, to, density([from, c1, to])));
        cursor = to;
      }
    }
  }

  if (current && current.length > 1) polys.push(current);
  return polys;
}

/** 多条 d 一次性铺开 */
export function parsePaths(list: string[]): Polyline[] {
  return list.flatMap((d) => parsePath(d));
}

/** 以 (cx,cy) 为基准等比缩放（对应旧的 wing-inner transform） */
export function scaleAbout(polys: Polyline[], s: number, cx: number, cy: number): Polyline[] {
  return polys.map((poly) => poly.map(([x, y]) => [cx + (x - cx) * s, cy + (y - cy) * s]));
}

/** 沿 x 轴镜像（旧左翼是 translate(1440 0) scale(-1 1)） */
export function mirrorX(polys: Polyline[]): Polyline[] {
  return polys.map((poly) => poly.map(([x, y]) => [2 * 720 - x, y]));
}

/**
 * 把折线按 dash/gap 切成一段段短线，返回线段端点对。
 * fat line（LineMaterial）不支持 stroke-dasharray，只能几何生成；
 * 每条子路径的图案重新起算，和旧 SVG 里「每条 path 各自一套 dash」的表现一致。
 */
export function dashPairs(polys: Polyline[], dash: number, gap: number): [Pt, Pt][] {
  const pairs: [Pt, Pt][] = [];

  for (const poly of polys) {
    let traveled = 0;

    for (let i = 1; i < poly.length; i += 1) {
      const [x0, y0] = poly[i - 1];
      const [x1, y1] = poly[i];
      const segLength = Math.hypot(x1 - x0, y1 - y0);
      if (segLength === 0) continue;

      let pos = 0;
      while (pos < segLength) {
        const phase = (traveled + pos) % (dash + gap);
        const inDash = phase < dash;
        /* 当前图案段还剩多长 */
        const room = inDash ? dash - phase : dash + gap - phase;
        const take = Math.min(room, segLength - pos);
        if (inDash && take > 1e-6) {
          const t0 = pos / segLength;
          const t1 = (pos + take) / segLength;
          pairs.push([
            [x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0],
            [x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1],
          ]);
        }
        pos += take;
      }

      traveled += segLength;
    }
  }

  return pairs;
}

/** 折线 → 线段端点对（实线用） */
export function polylinePairs(polys: Polyline[]): [Pt, Pt][] {
  const pairs: [Pt, Pt][] = [];
  for (const poly of polys) {
    for (let i = 1; i < poly.length; i += 1) pairs.push([poly[i - 1], poly[i]]);
  }
  return pairs;
}

/* ==========================================================
   翅膀（旧 SVG 只画右翼，左翼镜像：Butterfly.tsx:367）
   ========================================================== */

export const FOREWING =
  "M 744 468 C 752 418 784 348 818 300 C 832 280 846 248 858 230 C 873 222 889 236 903 256 C 936 300 964 350 978 402 C 988 434 984 464 974 484 C 962 508 938 522 908 530 C 878 538 844 538 814 530 C 786 522 766 510 756 494 C 748 482 744 474 744 468 Z";

export const HINDWING =
  "M 750 556 C 792 548 846 550 888 564 C 930 578 958 606 968 640 C 976 670 962 700 934 714 C 910 726 880 724 860 712 C 844 720 820 718 806 706 C 788 690 774 666 766 636 C 756 606 750 578 750 556 Z";

/** 旧 .wing-inner 的两条内轮廓，分别按 0.955 / 0.95 绕指定中心缩放 */
export const INNER_SHAPES: { d: string; scale: number; cx: number; cy: number }[] = [
  { d: FOREWING, scale: 0.955, cx: 720, cy: 470 },
  { d: HINDWING, scale: 0.95, cx: 720, cy: 560 },
];

export const FORE_MAIN = [
  "M 766 496 C 796 424 828 338 858 242",
  "M 766 500 C 806 438 858 354 920 288",
  "M 768 506 C 824 458 888 412 944 362",
  "M 770 512 C 832 484 904 460 960 444",
  "M 772 514 C 830 506 892 506 930 510",
  "M 774 522 C 816 528 866 530 908 528",
];

export const FORE_FINE = [
  "M 806 416 C 834 392 862 360 886 328",
  "M 824 374 C 848 348 872 318 890 292",
  "M 842 462 C 878 440 914 420 944 404",
  "M 820 504 C 862 494 912 486 944 478",
  "M 872 392 C 900 368 928 344 942 322",
  "M 898 328 C 924 354 946 390 948 428",
  "M 884 384 C 906 404 926 426 936 446",
  "M 856 342 C 878 366 896 388 910 408",
  "M 866 452 C 886 462 904 470 920 476",
  "M 800 470 C 836 470 872 476 900 488",
  "M 850 520 C 874 508 898 498 920 494",
  "M 838 260 C 860 262 882 274 898 292",
  "M 838 300 C 860 314 880 334 894 354",
  "M 868 470 C 890 482 912 496 928 510",
  "M 812 350 C 832 344 852 342 870 346",
  "M 884 400 C 906 414 926 434 938 454",
];

export const FORE_CELL =
  "M 784 500 C 812 448 838 382 852 320 C 880 346 906 390 916 438 C 892 478 846 500 802 504 Z";

export const HIND_MAIN = [
  "M 762 556 C 804 564 862 582 916 610",
  "M 762 558 C 802 590 846 632 880 670",
  "M 762 566 C 792 606 818 650 834 690",
  "M 764 576 C 784 612 798 652 804 688",
  "M 768 556 C 810 558 862 566 910 578",
];

export const HIND_FINE = [
  "M 814 574 C 844 600 872 634 892 666",
  "M 788 592 C 810 624 828 660 840 688",
  "M 880 600 C 900 624 918 650 928 674",
  "M 900 618 C 918 642 934 664 942 684",
  "M 860 586 C 882 606 900 622 912 636",
  "M 834 562 C 862 580 884 600 898 620",
  "M 806 606 C 828 632 846 660 858 686",
  "M 866 566 C 892 586 914 612 928 636",
  "M 842 610 C 866 632 886 658 900 682",
  "M 826 610 C 848 632 868 658 880 680",
  "M 884 620 C 902 640 916 660 926 678",
  "M 800 580 C 824 594 844 612 858 630",
];

export const HIND_CELL =
  "M 776 568 C 810 576 852 592 884 618 C 862 650 828 666 798 660 C 780 636 772 600 776 568 Z";

/** vein--bright 只取主脉前两条（旧代码 .slice(0, 2)） */
export const FORE_BRIGHT = FORE_MAIN.slice(0, 2);
export const HIND_BRIGHT = HIND_MAIN.slice(0, 2);

export const FORE_SPARKS: Pt[] = [
  [894, 326],
  [946, 462],
  [778, 470],
];

export const HIND_SPARKS: Pt[] = [
  [900, 590],
  [888, 690],
  [790, 608],
];

export const CURRENTS = [
  "M 766 500 C 806 438 858 354 920 288",
  "M 768 506 C 824 458 888 412 944 362",
  "M 762 556 C 804 564 862 582 916 610",
];

/**
 * 翅上光流车道：duration / offset / reverse 原值照搬（Butterfly.tsx:89-125）。
 * 每条 d 都是「M + 单个 C」，所以可以直接用三次贝塞尔精确表示，无需折线近似。
 */
export type FlowLane = {
  id: string;
  d: string;
  duration: number;
  offset: number;
  reverse: boolean;
};

export const FLOW_LANES: FlowLane[] = [
  { id: "fore-upper", d: "M 766 500 C 806 438 858 354 920 288", duration: 7.8, offset: 0.06, reverse: false },
  { id: "fore-mid", d: "M 768 506 C 824 458 888 412 944 362", duration: 6.4, offset: 0.44, reverse: true },
  { id: "fore-low", d: "M 772 518 C 830 512 892 516 930 524", duration: 5.6, offset: 0.2, reverse: false },
  { id: "hind-upper", d: "M 762 556 C 804 564 862 582 916 610", duration: 6.8, offset: 0.62, reverse: true },
  { id: "hind-low", d: "M 762 566 C 792 606 818 650 834 690", duration: 5.2, offset: 0.78, reverse: false },
];

/** 拆成 from / c1 / c2 / to 四个设计点，供 CubicBezierCurve3 使用 */
export function cubicFromPath(d: string): [Pt, Pt, Pt, Pt] {
  const poly = parsePath(d)[0];
  if (!poly || poly.length < 2) throw new Error("不是预期的三次贝塞尔路径：" + d);
  /* 用解析器的采样结果反推端点不可靠，这里直接取参数 */
  const args = d.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
  if (args.length !== 8) throw new Error("三次贝塞尔应当有 8 个数字：" + d);
  return [
    [args[0], args[1]],
    [args[2], args[3]],
    [args[4], args[5]],
    [args[6], args[7]],
  ];
}

export type CubicSpec = { from: Pt; c1: Pt; c2: Pt; to: Pt };

/**
 * 把一条 d 拆成若干段三次贝塞尔（M 之后每个 C 一段），供旗舰档的 TubeGeometry 使用。
 * 与 cubicFromPath 的区别：那个只服务 FLOW_LANES 里「单段 C」的车道，会校验 8 个数字；
 * 这里要能吃 FOREWING 那种多段 C 的闭合轮廓。
 */
export function cubicSegments(d: string): CubicSpec[] {
  const out: CubicSpec[] = [];
  let cursor: Pt = [0, 0];
  let start: Pt = [0, 0];

  for (const [, command, chunk] of d.matchAll(PATH_TOKEN)) {
    const args = chunk.match(/-?\d*\.?\d+/gi)?.map(Number) ?? [];
    const kind = command.toUpperCase();
    if (kind === "M") {
      start = [args[0], args[1]];
      cursor = start;
      continue;
    }
    if (kind === "Z") {
      cursor = start;
      continue;
    }
    if (kind !== "C") continue;
    for (let i = 0; i + 5 < args.length; i += 6) {
      const spec: CubicSpec = {
        from: cursor,
        c1: [args[i], args[i + 1]],
        c2: [args[i + 2], args[i + 3]],
        to: [args[i + 4], args[i + 5]],
      };
      out.push(spec);
      cursor = spec.to;
    }
  }

  return out;
}

/* ==========================================================
   躯干、触角、核心、插座
   ========================================================== */

export const BODY_OUTLINE = "M 720 446 C 742 470 742 630 720 690 C 698 630 698 470 720 446 Z";
export const BODY_INNER = "M 720 508 C 744 528 744 588 720 648 C 696 588 696 528 720 508 Z";
export const BODY_SPINE = "M 720 456 V 680";
export const BODY_RIBS =
  "M 708 544 Q 720 550 732 544 M 707 574 Q 720 580 733 574 M 708 604 Q 720 610 732 604 M 709 634 Q 720 640 731 634";

export const HEAD: { cx: number; cy: number; r: number } = { cx: 720, cy: 436, r: 8 };
export const HEAD_DOT: { cx: number; cy: number; r: number } = { cx: 720, cy: 436, r: 2.2 };

/** 触角：hinge 是 CSS 里 antenna-sway 的旋转支点（旧代码用两层 translate 造出来的） */
export const ANTENNA = [
  { d: "M 713 445 C 710 404 694 342 672 282", hinge: [713, 445] as Pt, tip: [672, 282] as Pt },
  { d: "M 727 445 C 730 404 746 342 768 282", hinge: [727, 445] as Pt, tip: [768, 282] as Pt },
];

export const CORE = {
  cx: 720,
  cy: 486,
  auraR: 140,
  orbR: 18,
  rings: [64, 44, 27],
  glint: { dx: -7, dy: -8, r: 4 },
  rays: [
    "M 720 408 V 434 M 720 538 V 564 M 642 486 H 668 M 772 486 H 798",
    "M 671 437 L 688 454 M 752 518 L 769 535 M 769 437 L 752 454 M 688 518 L 671 535",
    "M 720 452 V 468 M 720 504 V 520 M 686 486 H 702 M 738 486 H 754",
  ],
  /** 旧代码是 <ellipse rx ry transform="rotate(...)">，本质都是细长发光条 */
  beams: [
    { halfLength: 258, thickness: 3, rotation: 0, soft: false },
    { halfLength: 112, thickness: 2.8, rotation: 0, soft: true },
    { halfLength: 150, thickness: 1.6, rotation: 45, soft: true },
    { halfLength: 150, thickness: 1.6, rotation: -45, soft: true },
  ],
};

/** 圆的折线（SVG 的 <circle> 不是 path，需要自己铺点） */
export function circlePoly(cx: number, cy: number, r: number): Polyline {
  const divisions = Math.max(24, Math.min(120, Math.round((2 * Math.PI * r) / 4)));
  const poly: Polyline = [];
  for (let i = 0; i <= divisions; i += 1) {
    const a = (i / divisions) * Math.PI * 2;
    poly.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return poly;
}
