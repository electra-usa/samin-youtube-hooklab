"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { PERFORMANCE_TIERS } from "@/lib/taxonomy";
import { cn } from "@/lib/format";

/** "Outlier Score ⌄" multi-select of performance tiers (My Channel sort row). */
export function OutlierTierFilter({ selected, onToggle }: { selected: Set<string>; onToggle: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const single = selected.size === 1 ? PERFORMANCE_TIERS.find((t) => selected.has(t.id)) : undefined;
  const label = selected.size === 0 ? "Outlier Score" : single ? single.label : `${selected.size} tiers`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition",
          selected.size
            ? "border-primary bg-primary/10 text-primary dark:border-sky-300/60 dark:bg-sky-300/10 dark:text-white"
            : "border-stroke bg-white text-dark hover:bg-gray-100 dark:border-white/15 dark:bg-transparent dark:text-white dark:hover:bg-white/10",
        )}
      >
        {single && <span className={cn("inline-block size-2.5 shrink-0 rounded-full", single.dotClass)} aria-hidden />}
        <span>{label}</span>
        <ChevronDown className={cn("size-4 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-multiselectable
          className="absolute left-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-lg border border-stroke bg-white shadow-lg dark:border-white/10 dark:bg-[#1b1c1f]"
        >
          {PERFORMANCE_TIERS.map((t) => {
            const on = selected.has(t.id);
            return (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => onToggle(t.id)}
                className={cn(
                  "flex w-full items-center gap-3 border-b border-stroke px-4 py-2.5 text-left text-sm transition last:border-b-0 dark:border-white/10",
                  on ? "bg-primary/5 dark:bg-white/5" : "hover:bg-gray-50 dark:hover:bg-white/5",
                )}
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded border-2 transition",
                    on ? "border-primary bg-primary" : "border-stroke dark:border-white/20",
                  )}
                >
                  {on && <Check className="size-3 text-white" strokeWidth={3} />}
                </span>
                <span className={cn("inline-block size-2.5 shrink-0 rounded-full", t.dotClass)} aria-hidden />
                <span className="flex-1 text-dark dark:text-white">{t.label}</span>
                <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-xs font-medium", t.badgeClass)}>{t.scoreLabel}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
