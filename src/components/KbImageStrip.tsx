"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { kbImageAlt, kbImageSrc, type KbImage } from "@/lib/kb-images";

type KbImageStripProps = {
  images: KbImage[];
  /** 给读屏软件的一组名字，例如「知识点切片」「章节切片」 */
  label?: string;
};

/**
 * 教材页面切片的图栏：单图直接铺一张，多图横向 scroll-snap 滑动，点任意一张全屏放大。
 *
 * 三条实现约束：
 *  - 图片缺失时整栏收起。数据文件与图片是分两步落到仓库的（`kb-data.ts` 由外部工具生成，
 *    图放进 `public/images/kb/`），任一步没到位都不该在知识库里留一片碎图标。
 *  - 放大层的 Esc 走**捕获阶段 + stopPropagation**。`PanelShell.tsx:66` 在 document 上挂了
 *    冒泡阶段的 Esc 关面板，不拦的话一次 Esc 会把面板和放大层一起关掉。
 *  - 焦点进出放大层要还回去，否则关掉后 Tab 序会跳到看不见的元素上。
 */
export default function KbImageStrip({ images, label = "教材切片" }: KbImageStripProps) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [openAt, setOpenAt] = useState<number | null>(null);

  const scroller = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  const visible = useMemo(() => images.filter((image) => !failed.has(image.src)), [failed, images]);

  const markFailed = useCallback((src: string) => {
    setFailed((previous) => {
      if (previous.has(src)) return previous;
      const next = new Set(previous);
      next.add(src);
      return next;
    });
  }, []);

  const step = useCallback((delta: number) => {
    const scrollerNode = scroller.current;
    if (!scrollerNode) return;
    const card = scrollerNode.querySelector<HTMLElement>(".kb-shot");
    const width = card ? card.offsetWidth + 12 : scrollerNode.clientWidth * 0.8;
    scrollerNode.scrollBy({ left: delta * width, behavior: "smooth" });
  }, []);

  const openViewer = useCallback((index: number, source: HTMLElement | null) => {
    restoreFocusTo.current = source;
    setOpenAt(index);
  }, []);

  const closeViewer = useCallback(() => {
    setOpenAt(null);
    /* 直接同步还焦点。原先挂在 requestAnimationFrame 里，
       隐藏标签页中 rAF 被挂起，焦点就回不去缩略图（Tab 序会掉到 body 上）。 */
    restoreFocusTo.current?.focus({ preventScroll: true });
    restoreFocusTo.current = null;
  }, []);

  /* 图片全部加载失败时把开着的放大层也收掉，避免停在一个空框上 */
  useEffect(() => {
    if (openAt !== null && visible.length === 0) setOpenAt(null);
  }, [openAt, visible.length]);

  useEffect(() => {
    if (openAt === null) return;

    viewerRef.current?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        closeViewer();
        return;
      }
      if (visible.length < 2) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setOpenAt((current) => (current === null ? current : (current + 1) % visible.length));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setOpenAt((current) => (current === null ? current : (current - 1 + visible.length) % visible.length));
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [closeViewer, openAt, visible.length]);

  if (visible.length === 0) return null;

  const multiple = visible.length > 1;
  const current = openAt === null ? null : visible[Math.min(openAt, visible.length - 1)];

  return (
    <>
      <div
        className="kb-shots-wrap"
        role="group"
        aria-label={`${label}（${visible.length} 张）`}
      >
        <div className="kb-shots" data-count={visible.length} ref={scroller}>
          {visible.map((image, index) => (
            <button
              key={image.src}
              type="button"
              className="kb-shot"
              aria-label={`放大查看 ${kbImageAlt(image)}`}
              onClick={(event) => openViewer(index, event.currentTarget)}
            >
              <img
                src={kbImageSrc(image.src)}
                alt=""
                width={240}
                loading="lazy"
                decoding="async"
                draggable={false}
                onError={() => markFailed(image.src)}
              />
              {image.title ? <span className="kb-shot-title">{image.title}</span> : null}
              <span className="kb-shot-page" aria-hidden="true">
                P.{image.page}
              </span>
            </button>
          ))}
        </div>

        {multiple ? (
          <div className="kb-shots-nav">
            <button type="button" className="kb-shots-btn" aria-label="上一张" onClick={() => step(-1)}>
              <span aria-hidden="true">‹</span>
            </button>
            <span className="kb-shots-count">{visible.length} 张</span>
            <button type="button" className="kb-shots-btn" aria-label="下一张" onClick={() => step(1)}>
              <span aria-hidden="true">›</span>
            </button>
          </div>
        ) : null}
      </div>

      {current ? (
        <div
          ref={viewerRef}
          className="kb-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={kbImageAlt(current)}
          tabIndex={-1}
          onClick={closeViewer}
        >
          <div className="kb-lightbox-stage" onClick={(event) => event.stopPropagation()}>
            <img src={kbImageSrc(current.src)} alt={kbImageAlt(current)} decoding="async" draggable={false} />

            <div className="kb-lightbox-bar">
              <span className="kb-lightbox-caption">
                {current.title ? `${current.title} · ` : ""}P.{current.page}
              </span>
              <span className="kb-lightbox-index" aria-live="polite">
                {openAt !== null ? openAt + 1 : 1} / {visible.length}
              </span>
            </div>

            <div className="kb-lightbox-actions">
              {multiple ? (
                <>
                  <button
                    type="button"
                    className="kb-lightbox-nav"
                    aria-label="上一张"
                    onClick={() => setOpenAt((v) => (v === null ? v : (v - 1 + visible.length) % visible.length))}
                  >
                    <span aria-hidden="true">‹</span>
                  </button>
                  <button
                    type="button"
                    className="kb-lightbox-nav"
                    aria-label="下一张"
                    onClick={() => setOpenAt((v) => (v === null ? v : (v + 1) % visible.length))}
                  >
                    <span aria-hidden="true">›</span>
                  </button>
                </>
              ) : null}
              <button type="button" className="kb-lightbox-close" aria-label="关闭放大视图" onClick={closeViewer}>
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M7 7 17 17M17 7 7 17" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
