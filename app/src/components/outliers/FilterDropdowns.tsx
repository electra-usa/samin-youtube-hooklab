"use client";

import { useState, type ReactNode } from "react";
import { PERFORMANCE_TIERS, PUBLISH_DATE_WINDOWS, TRIGGER_PILL_CLASSES, triggerColor } from "@/lib/taxonomy";
import { cn } from "@/lib/format";
import { CheckBox, FilterTrigger, PANEL, useDismiss, useViewportShift } from "./controls";

// The filter-bar dropdowns: Outlier Score (tiers), Date (include/exclude window),
// and the include/exclude lists used for Click Trigger and Niche.

export function TierDropdown({
  label = "Outlier Score",
  selected,
  onToggle,
  activeClass,
  activeWhenAll = false,
}: {
  label?: string;
  selected: Set<string>;
  onToggle: (id: string) => void;
  activeClass?: string;
  /** Following treats any selection as active; Outliers only a partial one. */
  activeWhenAll?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const panelRef = useViewportShift(open);
  const all = selected.size === PERFORMANCE_TIERS.length;
  const active = selected.size > 0 && (activeWhenAll || !all);
  const single = selected.size === 1 ? PERFORMANCE_TIERS.find((t) => selected.has(t.id)) : null;
  return (
    <div className="relative" ref={ref}>
      <FilterTrigger
        label={label}
        open={open}
        active={active}
        activeClass={activeClass}
        onClick={() => setOpen((o) => !o)}
        leading={single ? <span className={cn("inline-block size-2.5 shrink-0 rounded-full", single.dotClass)} aria-hidden /> : null}
      />
      {open && (
        <div ref={panelRef} role="listbox" aria-multiselectable className={cn(PANEL, "left-0 w-64")}>
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
                  on ? "bg-primary/5 dark:bg-primary/15" : "hover:bg-gray-50 dark:hover:bg-white/5",
                )}
              >
                <CheckBox checked={on} />
                <span className={cn("inline-block size-2.5 shrink-0 rounded-full", t.dotClass)} aria-hidden />
                <span className="min-w-0 flex-1 text-dark dark:text-white">{t.label}</span>
                <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-xs font-medium", t.badgeClass)}>{t.scoreLabel}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function IncExcHeader({ sticky = true }: { sticky?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b border-stroke bg-white px-4 py-2 dark:border-white/10 dark:bg-[#1b1c1f]",
        sticky && "sticky top-0 z-10",
      )}
    >
      <span className="flex-1" />
      <span className="w-7 text-center text-xs font-semibold text-dark dark:text-white">Incl.</span>
      <span className="w-7 text-center text-xs font-semibold text-dark dark:text-white">Excl.</span>
    </div>
  );
}

export function IncExcRow({
  label,
  name,
  included,
  excluded,
  onInclude,
  onExclude,
  className,
}: {
  label: ReactNode;
  /** Accessible name when the label is not plain text. */
  name?: string;
  included: boolean;
  excluded: boolean;
  onInclude: () => void;
  onExclude: () => void;
  className?: string;
}) {
  const optionName = name ?? (typeof label === "string" ? label : "option");
  return (
    <div className={cn("flex items-center gap-3 text-sm", className)}>
      <span className="min-w-0 flex-1 truncate text-dark dark:text-white">{label}</span>
      <button
        type="button"
        onClick={onInclude}
        aria-label={`Include ${optionName}`}
        aria-pressed={included}
        className="flex size-7 shrink-0 items-center justify-center rounded transition hover:bg-primary/10"
      >
        <CheckBox checked={included} />
      </button>
      <button
        type="button"
        onClick={onExclude}
        aria-label={`Exclude ${optionName}`}
        aria-pressed={excluded}
        className="flex size-7 shrink-0 items-center justify-center rounded transition hover:bg-red-500/10"
      >
        <CheckBox checked={excluded} tone="exclude" />
      </button>
    </div>
  );
}

export function DateDropdown({
  include,
  exclude,
  onInclude,
  onExclude,
  activeClass,
}: {
  include: string;
  exclude: string;
  onInclude: (id: string) => void;
  onExclude: (id: string) => void;
  activeClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const panelRef = useViewportShift(open);
  return (
    <div className="relative" ref={ref}>
      <FilterTrigger
        label="Date"
        open={open}
        active={include !== "all" || exclude !== "all"}
        activeClass={activeClass}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div ref={panelRef} role="listbox" className={cn(PANEL, "left-0 max-h-[70vh] w-72 overflow-y-auto")}>
          <IncExcHeader />
          {PUBLISH_DATE_WINDOWS.filter((w) => w.id !== "all").map((w) => (
            <IncExcRow
              key={w.id}
              label={w.label}
              included={include === w.id}
              excluded={exclude === w.id}
              onInclude={() => onInclude(include === w.id ? "all" : w.id)}
              onExclude={() => onExclude(exclude === w.id ? "all" : w.id)}
              className="border-b border-stroke px-4 py-3 last:border-b-0 dark:border-white/10"
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Click Trigger / Niche: every option can be included or excluded. */
export function IncludeExcludeDropdown({
  label,
  options,
  included,
  excluded,
  onInclude,
  onExclude,
  colorTriggers,
  activeClass,
}: {
  label: string;
  options: string[];
  included: Set<string>;
  excluded: Set<string>;
  onInclude: (value: string) => void;
  onExclude: (value: string) => void;
  colorTriggers?: boolean;
  activeClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const panelRef = useViewportShift(open);
  return (
    <div className="relative" ref={ref}>
      <FilterTrigger
        label={label}
        open={open}
        active={included.size > 0 || excluded.size > 0}
        activeClass={activeClass}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div ref={panelRef} className={cn(PANEL, "left-0 max-h-[70vh] w-72 overflow-y-auto")}>
          <IncExcHeader />
          {options.map((o) => (
            <IncExcRow
              key={o}
              name={o}
              label={
                colorTriggers ? (
                  <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", TRIGGER_PILL_CLASSES[triggerColor(o)])}>{o}</span>
                ) : (
                  o
                )
              }
              included={included.has(o)}
              excluded={excluded.has(o)}
              onInclude={() => onInclude(o)}
              onExclude={() => onExclude(o)}
              className="border-b border-stroke px-4 py-3 last:border-b-0 dark:border-white/10"
            />
          ))}
        </div>
      )}
    </div>
  );
}

export { IncExcHeader };
