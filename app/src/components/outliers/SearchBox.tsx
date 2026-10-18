"use client";

import { useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { SEARCH_MODES } from "@/lib/taxonomy";
import type { SearchMode } from "@/lib/research/filters";
import { cn } from "@/lib/format";
import { CheckBox, MUTED, useDismiss, useViewportShift } from "./controls";

/** Search field with a clear button; `embedded` drops its own border (inside the mode selector group). */
export function SearchBox({
  value,
  onChange,
  onSubmit,
  onClear,
  placeholder,
  ariaLabel,
  className,
  embedded,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  placeholder: string;
  ariaLabel: string;
  className?: string;
  embedded?: boolean;
}) {
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className={cn("flex min-w-0", !embedded && "max-w-md", className)}
    >
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center overflow-hidden",
          embedded
            ? "bg-transparent"
            : "rounded-lg border border-stroke bg-white focus-within:ring-2 focus-within:ring-primary dark:border-white/10 dark:bg-[#18191c]",
        )}
      >
        <div className="relative min-w-0 flex-1">
          <input
            type="search"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            aria-label={ariaLabel}
            className="w-full border-0 bg-transparent py-2 pl-3 pr-14 text-sm text-dark outline-none placeholder:text-dark-5 focus:ring-0 dark:text-white dark:placeholder:text-gray-500 [&::-webkit-search-cancel-button]:hidden"
          />
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
            {value.trim() ? (
              <button
                type="button"
                onClick={onClear}
                aria-label="Clear search"
                className="flex size-7 items-center justify-center rounded text-dark-5 hover:bg-gray-100 hover:text-dark dark:hover:bg-white/10 dark:hover:text-white"
              >
                ×
              </button>
            ) : null}
            <span className="pointer-events-none text-dark-5 dark:text-gray-400">
              <Search className="size-4" />
            </span>
          </div>
        </div>
      </div>
    </form>
  );
}

/** "Topic ⌄" selector at the left of the Outliers search box, with mode descriptions. */
export function SearchModeSelect({ value, onChange }: { value: SearchMode; onChange: (mode: SearchMode) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const panelRef = useViewportShift(open);
  const current = SEARCH_MODES.find((m) => m.id === value) ?? SEARCH_MODES[0];
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-full w-[8.75rem] items-center gap-2 border-r border-stroke bg-transparent px-3 py-2 text-sm font-medium text-dark transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-white/10 dark:text-white dark:hover:bg-white/5"
      >
        <span className="min-w-0 flex-1 truncate text-left">{current.label}</span>
        <ChevronDown className={cn("size-4 shrink-0 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div
          ref={panelRef}
          role="listbox"
          className="absolute left-0 top-full z-50 mt-2 w-80 rounded-lg border border-stroke bg-white shadow-lg dark:border-white/10 dark:bg-[#1b1c1f]"
        >
          {SEARCH_MODES.map((m) => {
            const selected = m.id === value;
            return (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(m.id as SearchMode);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-3 border-b border-stroke px-4 py-3 text-left transition last:border-b-0 dark:border-white/10",
                  selected ? "bg-primary/5 dark:bg-primary/15" : "hover:bg-gray-50 dark:hover:bg-white/5",
                )}
              >
                <CheckBox checked={selected} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-dark dark:text-white">{m.label}</span>
                  <span className={cn("mt-0.5 block text-xs leading-5", MUTED)}>
                    {m.description}
                    {m.id === "thumbnail" && " (HookLab matches the title's topic instead.)"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
