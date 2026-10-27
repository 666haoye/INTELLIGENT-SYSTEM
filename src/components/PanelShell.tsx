"use client";

import { useEffect, useRef, type ReactNode } from "react";

type PanelShellProps = {
  labelledBy: string;
  describedBy?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
};

function getFocusable(panel: HTMLElement): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.offsetParent !== null);
}

export default function PanelShell({
  labelledBy,
  describedBy,
  onClose,
  children,
  className = "",
}: PanelShellProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const autofocus = coarsePointer
      ? null
      : panel.querySelector<HTMLElement>("[data-panel-autofocus]");
    const focusables = getFocusable(panel);
    (autofocus ?? focusables[0] ?? panel).focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const items = getFocusable(panel);
      if (!items.length) return;

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="panel-overlay">
      <div className="panel-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        className={`panel ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
