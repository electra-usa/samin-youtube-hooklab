"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/format";

// Small building blocks shared by the Outliers, Following and Bookmarks pages.

export const MUTED = "text-[var(--color-muted)]";

const FILTER_BASE = "flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition";
const FILTER_IDLE =
  "border-stroke bg-white text-dark hover:bg-gray-50 dark:border-white/10 dark:bg-[#18191c] dark:text-white dark:hover:bg-white/5";
/** Outliers marks an active filter with a navy outline; Following tints it. */
export const FILTER_ACTIVE_OUTLINE = "border-primary bg-white text-primary dark:border-sky-300/60 dark:bg-[#18191c] dark:text-white";
export const FILTER_ACTIVE_TINT = "border-primary bg-primary/10 text-primary dark:bg-primary/25 dark:text-white";

export const PANEL =
  "absolute top-full z-50 mt-2 rounded-lg border border-stroke bg-white shadow-lg dark:border-white/10 dark:bg-[#1b1c1f]";

export function filterButtonClass(active: boolean, activeClass = FILTER_ACTIVE_OUTLINE) {
  return cn(FILTER_BASE, active ? activeClass : FILTER_IDLE);
}

export function FilterTrigger({
  label,
  open,
  active,
  activeClass,
  onClick,
  leading,
}: {
  label: ReactNode;
  open: boolean;
  active: boolean;
  activeClass?: string;
  onClick: () => void;
  leading?: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} aria-haspopup="listbox" aria-expanded={open} className={filterButtonClass(active, activeClass)}>
      {leading}
      <span>{label}</span>
      <ChevronDown className={cn("size-4 transition", open && "rotate-180")} />
    </button>
  );
}

/** Square checkbox: navy with a tick to include, red with a dash to exclude. */
export function CheckBox({ checked, tone = "include", className }: { checked: boolean; tone?: "include" | "exclude"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded border",
        checked
          ? tone === "exclude"
            ? "border-[#e02b27] bg-[#e02b27] text-white"
            : "border-primary bg-primary text-white dark:border-sky-500 dark:bg-sky-600"
          : "border-gray-500 bg-white dark:border-gray-500 dark:bg-transparent",
        className,
      )}
    >
      {checked &&
        (tone === "exclude" ? (
          <svg className="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
          </svg>
        ) : (
          <svg className="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ))}
    </span>
  );
}

/** Close a floating panel on outside mousedown or Escape. */
export function useDismiss<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return ref;
}

/** Keep a dropdown panel inside the viewport horizontally (original useViewportAwareDropdown). */
export function useViewportShift(open: boolean) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const fit = () => {
      panel.style.transform = "";
      const rect = panel.getBoundingClientRect();
      const overflow = rect.right - (window.innerWidth - 8);
      if (overflow > 0) panel.style.transform = `translateX(${-Math.min(overflow, rect.left - 8)}px)`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [open]);
  return panelRef;
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block size-8 animate-spin rounded-full border-2 border-primary border-t-transparent", className)} />;
}

export function EmptyState({ message, icon, action, className }: { message: ReactNode; icon?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-stroke bg-gray-100 py-12 text-center dark:border-white/10 dark:bg-[#18191c]", className)}>
      {icon && <div className="mb-4 flex justify-center">{icon}</div>}
      <p className={MUTED}>{message}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export const GRID = "grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]";

export function GridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className={GRID} aria-busy="true" aria-label="Loading videos">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="animate-pulse rounded-lg border border-stroke bg-gray-100 dark:border-white/10 dark:bg-white/5">
          <div className="aspect-video w-full rounded-t-lg bg-gray-300 dark:bg-white/10" />
          <div className="space-y-2 p-3">
            <div className="h-4 w-3/4 rounded bg-gray-300 dark:bg-white/10" />
            <div className="h-3 w-1/2 rounded bg-gray-300 dark:bg-white/10" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Calls onReach when the sentinel nears the scroll container's bottom (200px early). */
export function InfiniteSentinel({ onReach, disabled }: { onReach: () => void; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onReach);
  useEffect(() => {
    cb.current = onReach;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;
    const root = el.closest("main");
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && cb.current(), {
      root,
      rootMargin: "200px",
      threshold: 0,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [disabled]);
  return <div ref={ref} className="h-4" aria-hidden />;
}

/** Underlined Videos | Shorts switch (original VideoTypeTabs). */
export function VideoTypeTabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (value: T) => void;
  tabs: { id: T; label: string }[];
}) {
  return (
    <div className="border-b border-stroke dark:border-white/10" role="tablist">
      <div className="flex gap-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={value === t.id}
            onClick={() => onChange(t.id)}
            className={cn(
              "relative pb-3 text-sm font-medium transition",
              value === t.id ? "text-dark dark:text-white" : "text-dark-5 hover:text-dark dark:text-gray-400 dark:hover:text-white",
            )}
          >
            {t.label}
            {value === t.id && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-dark dark:bg-white" aria-hidden />}
          </button>
        ))}
      </div>
    </div>
  );
}
