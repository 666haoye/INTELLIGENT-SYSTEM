"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { kbImageAlt, kbImageSrc, type KbImage } from "@/lib/kb-images";

type KbImageTabsProps = {
  images: KbImage[];
  /** 给读屏软件的一组名字，例如「随机梯度下降 原书切片」 */
  label?: string;
};

/**
 * 原书对照台：一组页码 Tab + 一张大图，点大图全屏放大。
 *
 * 四段实现是从 `KbImageStrip.tsx` 逐字搬来的，它们各自对应一个踩过的坑：
 *  - 放大层的 Esc 走**捕获阶段 + stopPropagation**。`PanelShell.tsx:42` 在 document 上挂的是
 *    冒泡阶段的 Esc（关整个面板），不拦的话按一下会把放大层和面板一起关掉。
 *  - 关放大层时**同步**还焦点。挂在 requestAnimationFrame 里会失效——隐藏标签页 rAF 被挂起，
 *    焦点回不去，Tab 序掉到 body 上。
 *  - 图片 404 就整块收起（`visible.length === 0` 时 return null）。数据与图片是分两步落库的，
 *    任一步没到位都不该在知识库里留一片碎图标。
 *  - 放大层沿用 `.kb-lightbox*` 类名，白拿 globals.css:3474-3576 那套已冻结的样式
 *    （含 z-index 70，压在 `.panel-overlay` 的 60 之上）。
 *
 * 与 KbImageStrip 的差别：当前项与放大项都按 **src** 记录而不是按数组下标。404 过滤会让下标
 * 整体前移，按 src 记就天然免疫；且被放大的那张一旦失败，`openIndex` 自然变 -1、放大层自动关闭，
 * 不需要 KbImageStrip:63-65 那个补丁 effect。
 */
export default function KbImageTabs({ images, label = "教材切片" }: KbImageTabsProps) {
  const groupId = useId();
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [activeSrc, setActiveSrc] = useState<string | null>(null);
  const [openSrc, setOpenSrc] = useState<string | null>(null);

  const viewerRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);
  const tablistRef = useRef<HTMLDivElement | null>(null);

  const visible = useMemo(
    () => images.filter((image) => !failed.has(image.src)),
    [failed, images],
  );

  const markFailed = useCallback((src: string) => {
    setFailed((previous) => {
      if (previous.has(src)) return previous;
      const next = new Set(previous);
      next.add(src);
      return next;
    });
  }, []);

  /* 没被点过的 Tab 不预设下标：当前项优先跟随记住的 src，否则退到第一张。 */
  const current =
    visible.find((image) => image.src === activeSrc) ?? visible[0];
  const currentIndex = current ? visible.indexOf(current) : -1;

  const openIndex = openSrc === null ? -1 : visible.findIndex((image) => image.src === openSrc);
  const viewing = openIndex === -1 ? null : visible[openIndex];

  const openViewer = useCallback(
    (image: KbImage, source: HTMLElement | null) => {
      restoreFocusTo.current = source;
      setActiveSrc(image.src);
      setOpenSrc(image.src);
    },
    [],
  );

  const closeViewer = useCallback(() => {
    setOpenSrc(null);
    restoreFocusTo.current?.focus({ preventScroll: true });
    restoreFocusTo.current = null;
  }, []);

  const stepInViewer = useCallback(
    (delta: number) => {
      if (openIndex === -1 || visible.length < 2) return;
      const next = (openIndex + delta + visible.length) % visible.length;
      setOpenSrc(visible[next].src);
    },
    [openIndex, visible],
  );

  useEffect(() => {
    if (openSrc === null) return;
    /* 放大层里那张图自己也可能 404 —— 补上标记，交给 openIndex 收敛掉这层。 */
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
        stepInViewer(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepInViewer(-1);
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [closeViewer, openSrc, stepInViewer, visible.length]);

  if (!current) return null;

  const multiple = visible.length > 1;

  /* role="tablist" 的键盘约定：左右换 Tab 并把焦点交给新 Tab。 */
  const onTabListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const offset = visible.length > 1 ? currentIndex : 0;
    const target =
      event.key === "ArrowRight"
        ? (offset + 1) % visible.length
        : event.key === "ArrowLeft"
          ? (offset - 1 + visible.length) % visible.length
          : event.key === "Home"
            ? 0
            : visible.length - 1;
    if (multiple) {
      setActiveSrc(visible[target].src);
      tablistRef.current
        ?.querySelectorAll<HTMLElement>('[role="tab"]')
        ?.[target]?.focus({ preventScroll: true });
    }
  };

  return (
    <>
      <div className="kb-plate" role="group" aria-label={`${label}（${visible.length} 页）`}>
        {multiple ? (
          <div
            ref={tablistRef}
            className="kb-tabs"
            role="tablist"
            aria-label={`${label} 原书页码`}
            onKeyDown={onTabListKeyDown}
          >
            {visible.map((image, index) => (
              <button
                key={image.src}
                type="button"
                role="tab"
                id={`${groupId}-tab-${index}`}
                aria-selected={index === currentIndex}
                aria-controls={`${groupId}-panel`}
                tabIndex={index === currentIndex ? 0 : -1}
                className={`kb-tab${index === currentIndex ? " is-active" : ""}`}
                onClick={() => setActiveSrc(image.src)}
              >
                P.{image.page}
              </button>
            ))}
          </div>
        ) : null}

        <div
          className="kb-plate-viewer"
          role="tabpanel"
          id={`${groupId}-panel`}
          aria-labelledby={multiple ? `${groupId}-tab-${currentIndex}` : undefined}
        >
          <button
            type="button"
            className="kb-frame"
            aria-label={`放大查看 ${kbImageAlt(current)}`}
            onClick={(event) => openViewer(current, event.currentTarget)}
          >
            <img
              src={kbImageSrc(current.src)}
              alt={kbImageAlt(current)}
              loading="lazy"
              decoding="async"
              draggable={false}
              onError={() => markFailed(current.src)}
            />
          </button>
          <p className="kb-plate-caption">
            原书 P.{current.page} 节选
            {current.title ? <span className="kb-plate-title">{current.title}</span> : null}
            {multiple ? (
              <span className="kb-plate-count" aria-live="polite">
                {currentIndex + 1} / {visible.length}
              </span>
            ) : null}
          </p>
        </div>
      </div>

      {viewing ? (
        <div
          ref={viewerRef}
          className="kb-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={kbImageAlt(viewing)}
          tabIndex={-1}
          onClick={closeViewer}
        >
          <div className="kb-lightbox-stage" onClick={(event) => event.stopPropagation()}>
            <img
              src={kbImageSrc(viewing.src)}
              alt={kbImageAlt(viewing)}
              decoding="async"
              draggable={false}
              onError={() => markFailed(viewing.src)}
            />

            <div className="kb-lightbox-bar">
              <span className="kb-lightbox-caption">
                {viewing.title ? `${viewing.title} · ` : ""}原书 P.{viewing.page} 节选
              </span>
              <span className="kb-lightbox-index" aria-live="polite">
                {openIndex + 1} / {visible.length}
              </span>
            </div>

            <div className="kb-lightbox-actions">
              {multiple ? (
                <>
                  <button
                    type="button"
                    className="kb-lightbox-nav"
                    aria-label="上一页"
                    onClick={() => stepInViewer(-1)}
                  >
                    <span aria-hidden="true">‹</span>
                  </button>
                  <button
                    type="button"
                    className="kb-lightbox-nav"
                    aria-label="下一页"
                    onClick={() => stepInViewer(1)}
                  >
                    <span aria-hidden="true">›</span>
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="kb-lightbox-close"
                aria-label="关闭放大视图"
                onClick={closeViewer}
              >
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
