"use client";

import { useEffect, useRef } from "react";
import { MODULE_NODES, type WingSide } from "@/lib/nodes";

const FOREWING =
  "M 744 468 C 752 418 784 348 818 300 C 832 280 846 248 858 230 C 873 222 889 236 903 256 C 936 300 964 350 978 402 C 988 434 984 464 974 490 C 962 520 938 542 908 554 C 878 566 844 566 814 556 C 786 548 766 532 756 510 C 748 494 744 480 744 468 Z";

const HINDWING =
  "M 750 544 C 792 534 846 536 888 552 C 930 568 958 600 968 638 C 976 670 962 700 934 714 C 910 726 880 724 860 712 C 844 720 820 718 806 706 C 788 690 774 666 766 636 C 756 606 750 574 750 544 Z";

const FORE_MAIN = [
  "M 766 496 C 796 424 828 338 858 242",
  "M 766 500 C 806 438 858 354 920 288",
  "M 768 506 C 824 458 888 412 944 362",
  "M 770 512 C 832 484 904 460 960 444",
  "M 772 518 C 830 512 892 516 930 524",
  "M 774 526 C 816 538 866 548 908 556",
];

const FORE_FINE = [
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

const FORE_CELL =
  "M 784 500 C 812 448 838 382 852 320 C 880 346 906 390 916 438 C 892 486 846 518 802 524 Z";

const HIND_MAIN = [
  "M 762 552 C 804 562 862 580 916 610",
  "M 762 558 C 802 590 846 632 880 670",
  "M 762 566 C 792 606 818 650 834 690",
  "M 764 576 C 784 612 798 652 804 688",
  "M 768 540 C 810 546 862 556 910 574",
];

const HIND_FINE = [
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

const HIND_CELL =
  "M 776 568 C 810 576 852 592 884 618 C 862 650 828 666 798 660 C 780 636 772 600 776 568 Z";

const FORE_SPARKS: Array<[number, number]> = [
  [894, 326],
  [946, 462],
  [778, 470],
];

const HIND_SPARKS: Array<[number, number]> = [
  [900, 590],
  [888, 690],
  [790, 608],
];

type FlowLane = {
  id: string;
  d: string;
  duration: number;
  offset: number;
  reverse: boolean;
};

const FLOW_LANES: FlowLane[] = [
  {
    id: "fore-upper",
    d: "M 766 500 C 806 438 858 354 920 288",
    duration: 7.8,
    offset: 0.06,
    reverse: false,
  },
  {
    id: "fore-mid",
    d: "M 768 506 C 824 458 888 412 944 362",
    duration: 6.4,
    offset: 0.44,
    reverse: true,
  },
  {
    id: "fore-low",
    d: "M 772 518 C 830 512 892 516 930 524",
    duration: 5.6,
    offset: 0.2,
    reverse: false,
  },
  {
    id: "hind-upper",
    d: "M 762 552 C 804 562 862 580 916 610",
    duration: 6.8,
    offset: 0.62,
    reverse: true,
  },
  {
    id: "hind-low",
    d: "M 762 566 C 792 606 818 650 834 690",
    duration: 5.2,
    offset: 0.78,
    reverse: false,
  },
];

type ButterflyProps = {
  hoveredSide: WingSide | null;
  flowOn: boolean;
  tempo: number;
  litPulse: { side: WingSide; key: number } | null;
};

function WingSockets() {
  return (
    <g className="wing-sockets" aria-hidden="true">
      {MODULE_NODES.map((node) => (
        <g
          key={node.id}
          transform={`translate(${(node.x * 1440).toFixed(2)} ${(node.y * 900).toFixed(2)})`}
        >
          <circle className="socket-ring socket-ring--outer" r="48" />
          <circle className="socket-ring" r="33" />
          <path className="socket-cross" d="M -55 0 H -46 M 46 0 H 55 M 0 -55 V -46 M 0 46 V 55" />
        </g>
      ))}
    </g>
  );
}

function WingArt() {
  return (
    <g className="wing-art">
      <g className="wing-glows">
        <path d={FOREWING} fill="none" stroke="#1d4ed8" strokeWidth={10} strokeOpacity={0.1} />
        <path d={FOREWING} fill="none" stroke="#0ea5e9" strokeWidth={4} strokeOpacity={0.18} />
        <path d={FOREWING} fill="none" stroke="#38bdf8" strokeWidth={2.4} strokeOpacity={0.25} />
        <path d={HINDWING} fill="none" stroke="#1d4ed8" strokeWidth={10} strokeOpacity={0.1} />
        <path d={HINDWING} fill="none" stroke="#0ea5e9" strokeWidth={4} strokeOpacity={0.18} />
        <path d={HINDWING} fill="none" stroke="#38bdf8" strokeWidth={2.4} strokeOpacity={0.25} />
      </g>

      <g className="wing-lines">
        <path className="wing-outline" d={FOREWING} />
        <path className="wing-outline" d={HINDWING} />
        <path
          className="wing-inner"
          d={FOREWING}
          transform="translate(720 470) scale(0.955) translate(-720 -470)"
        />
        <path
          className="wing-inner"
          d={HINDWING}
          transform="translate(720 560) scale(0.95) translate(-720 -560)"
        />

        <g className="vein-glow">
          {FORE_MAIN.map((d) => (
            <path key={`fg-${d}`} d={d} />
          ))}
          {HIND_MAIN.map((d) => (
            <path key={`hg-${d}`} d={d} />
          ))}
        </g>

        <g className="wing-veins">
          {FORE_MAIN.map((d) => (
            <path key={d} className="vein" d={d} />
          ))}
          {FORE_FINE.map((d) => (
            <path key={d} className="vein vein--fine" d={d} />
          ))}
          <path className="vein vein--cell" d={FORE_CELL} />
          {HIND_MAIN.map((d) => (
            <path key={d} className="vein" d={d} />
          ))}
          {HIND_FINE.map((d) => (
            <path key={d} className="vein vein--fine" d={d} />
          ))}
          <path className="vein vein--cell" d={HIND_CELL} />
          {FORE_MAIN.slice(0, 2).map((d) => (
            <path key={`fb-${d}`} className="vein vein--bright" d={d} />
          ))}
          {HIND_MAIN.slice(0, 2).map((d) => (
            <path key={`hb-${d}`} className="vein vein--bright" d={d} />
          ))}
        </g>

        <g className="wing-sparks">
          {FORE_SPARKS.map(([cx, cy]) => (
            <circle key={`fs-${cx}-${cy}`} cx={cx} cy={cy} r="1.7" />
          ))}
          {HIND_SPARKS.map(([cx, cy]) => (
            <circle key={`hs-${cx}-${cy}`} cx={cx} cy={cy} r="1.6" />
          ))}
        </g>

        <g className="wing-currents">
          <path d="M 766 500 C 806 438 858 354 920 288" />
          <path d="M 768 506 C 824 458 888 412 944 362" />
          <path d="M 762 552 C 804 562 862 580 916 610" />
        </g>
      </g>

      <g className="flow-sources" aria-hidden="true">
        {FLOW_LANES.map((lane) => (
          <path key={lane.id} d={lane.d} data-flow-source />
        ))}
      </g>

      <g className="flow-packets" aria-hidden="true">
        {FLOW_LANES.map((lane) => (
          <g
            key={lane.id}
            className="flow-packet"
            data-flow-packet
            style={{ opacity: 0 }}
          >
            <circle r="10" fill="url(#flowDotGlow)" />
            <circle r="3.4" fill="#38bdf8" fillOpacity="0.5" />
            <circle r="1.7" fill="#f0feff" />
          </g>
        ))}
      </g>
    </g>
  );
}

export default function Butterfly({ hoveredSide, flowOn, tempo, litPulse }: ButterflyProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  /* A trail reached a wing node: let a soft glow wash along that wing's veins. */
  useEffect(() => {
    if (!litPulse) return;
    const svg = svgRef.current;
    if (!svg) return;
    const wing = svg.querySelector<SVGGElement>(`[data-side="${litPulse.side}"]`);
    if (!wing) return;

    wing.classList.remove("is-conducting");
    void wing.getBoundingClientRect();
    wing.classList.add("is-conducting");

    const timer = window.setTimeout(() => wing.classList.remove("is-conducting"), 1500);
    return () => window.clearTimeout(timer);
  }, [litPulse]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const sources = Array.from(svg.querySelectorAll<SVGPathElement>("[data-flow-source]"));
    const packets = Array.from(svg.querySelectorAll<SVGGElement>("[data-flow-packet]"));
    if (!sources.length || !packets.length) return;

    if (!flowOn) {
      return;
    }

    const lanes = sources
      .map((path, index) => {
        const packet = packets[index];
        const spec = FLOW_LANES[index % FLOW_LANES.length];
        const length = path.getTotalLength();
        return {
          path,
          packet,
          length,
          duration: spec.duration * tempo,
          offset: (spec.offset + Math.floor(index / FLOW_LANES.length) * 0.17) % 1,
          reverse: spec.reverse,
        };
      })
      .filter((lane) => lane.length > 0 && lane.packet);

    let frame = 0;
    const started = performance.now();

    const tick = (now: number) => {
      const seconds = (now - started) / 1000;

      for (const lane of lanes) {
        const cycle = (seconds / lane.duration + lane.offset) % 1;
        const progress = lane.reverse ? 1 - cycle : cycle;
        const point = lane.path.getPointAtLength(lane.length * progress);
        lane.packet.setAttribute(
          "transform",
          `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})`,
        );
        const edge = Math.min(cycle, 1 - cycle);
        lane.packet.style.opacity = String(Math.min(1, edge * 8) * 0.95);
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [flowOn, tempo]);

  return (
    <svg
      ref={svgRef}
      className="butterfly-svg"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid meet"
      data-hovered={hoveredSide ?? undefined}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="wingStroke" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#1d4ed8" stopOpacity="0.42" />
          <stop offset="46%" stopColor="#38bdf8" stopOpacity="0.88" />
          <stop offset="100%" stopColor="#e0fcff" stopOpacity="1" />
        </linearGradient>

        <radialGradient id="coreGlowGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#d8fbff" stopOpacity="0.72" />
          <stop offset="26%" stopColor="#38bdf8" stopOpacity="0.32" />
          <stop offset="60%" stopColor="#1d4ed8" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#020617" stopOpacity="0" />
        </radialGradient>

        <radialGradient id="coreOrbGrad" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="42%" stopColor="#e8feff" />
          <stop offset="72%" stopColor="#7dd3fc" />
          <stop offset="100%" stopColor="#2563eb" />
        </radialGradient>

        <radialGradient id="flowDotGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#e8feff" stopOpacity="0.8" />
          <stop offset="35%" stopColor="#38bdf8" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0" />
        </radialGradient>

        <linearGradient id="coreBeam" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0" />
          <stop offset="28%" stopColor="#38bdf8" stopOpacity="0.24" />
          <stop offset="50%" stopColor="#d8fbff" stopOpacity="0.8" />
          <stop offset="72%" stopColor="#38bdf8" stopOpacity="0.24" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* left wing: mirrored copy of the right wing drawing */}
      <g className="wing wing--left" data-side="left" transform="translate(1440 0) scale(-1 1)">
        <WingArt />
      </g>
      <g className="wing wing--right" data-side="right">
        <WingArt />
      </g>

      <WingSockets />

      <g className="body" aria-hidden="true">
        <path className="body-glow" d="M 720 446 C 742 470 742 630 720 690 C 698 630 698 470 720 446 Z" />
        <path className="body-line" d="M 720 446 C 742 470 742 630 720 690 C 698 630 698 470 720 446 Z" />
        <path className="body-line" d="M 720 508 C 744 528 744 588 720 648 C 696 588 696 528 720 508 Z" />
        <path className="body-line body-line--fine" d="M 720 456 V 680" />
        <path className="body-ribs" d="M 708 544 Q 720 550 732 544 M 707 574 Q 720 580 733 574 M 708 604 Q 720 610 732 604 M 709 634 Q 720 640 731 634" />
        <circle className="head-line" cx="720" cy="436" r="8" />
        <circle className="head-dot" cx="720" cy="436" r="2.2" />

        <g className="antenna antenna--left">
          <g transform="translate(713 445)">
            <g className="antenna-sway">
              <g transform="translate(-713 -445)">
                <path className="antenna-line" d="M 713 445 C 710 404 694 342 672 282" />
                <circle className="antenna-tip" cx="672" cy="282" r="3.2" />
              </g>
            </g>
          </g>
        </g>
        <g className="antenna antenna--right">
          <g transform="translate(727 445)">
            <g className="antenna-sway">
              <g transform="translate(-727 -445)">
                <path className="antenna-line" d="M 727 445 C 730 404 746 342 768 282" />
                <circle className="antenna-tip" cx="768" cy="282" r="3.2" />
              </g>
            </g>
          </g>
        </g>
      </g>

      <g className="energy-core" aria-hidden="true">
        <circle className="core-aura" cx="720" cy="486" r="140" fill="url(#coreGlowGrad)" />
        <ellipse className="core-beam" cx="720" cy="486" rx="258" ry="1.5" fill="url(#coreBeam)" />
        <ellipse
          className="core-beam core-beam--soft"
          cx="720"
          cy="486"
          rx="1.4"
          ry="112"
          transform="rotate(90 720 486)"
          fill="url(#coreBeam)"
        />
        <ellipse
          className="core-beam core-beam--soft"
          cx="720"
          cy="486"
          rx="150"
          ry="0.8"
          transform="rotate(45 720 486)"
          fill="url(#coreBeam)"
        />
        <ellipse
          className="core-beam core-beam--soft"
          cx="720"
          cy="486"
          rx="150"
          ry="0.8"
          transform="rotate(-45 720 486)"
          fill="url(#coreBeam)"
        />
        <g className="core-pulse">
          <circle className="core-ring core-ring--outer" cx="720" cy="486" r="64" />
          <circle className="core-ring" cx="720" cy="486" r="44" />
          <circle className="core-ring core-ring--hot" cx="720" cy="486" r="27" />
          <circle className="core-orb" cx="720" cy="486" r="18" fill="url(#coreOrbGrad)" />
          <circle className="core-glint" cx="713" cy="478" r="4" fill="#ffffff" />
        </g>
        <g className="core-rays">
          <path d="M 720 408 V 434 M 720 538 V 564 M 642 486 H 668 M 772 486 H 798" />
          <path d="M 671 437 L 688 454 M 752 518 L 769 535 M 769 437 L 752 454 M 688 518 L 671 535" />
          <path d="M 720 452 V 468 M 720 504 V 520 M 686 486 H 702 M 738 486 H 754" opacity="0.55" />
        </g>
      </g>
    </svg>
  );
}
