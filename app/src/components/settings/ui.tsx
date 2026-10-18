"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Popover } from "@/components/ui/Popover";
import { cn } from "@/lib/format";

// Small form building blocks for the Settings tabs (card, labels, multi-select, pills, sliders).

export const inputClass =
  "w-full rounded-lg border border-stroke bg-white px-4 py-2.5 text-sm text-dark outline-none transition placeholder:text-dark-5 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-70 dark:border-white/15 dark:bg-transparent dark:text-white dark:focus:border-sky-300";

export function SettingsCard({
  title,
  description,
  children,
  className,
  titleClassName,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
  titleClassName?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn("scroll-mt-6 rounded-xl border border-stroke bg-white p-6 dark:border-white/10 dark:bg-[#18191c]", className)}
    >
      {title && (
        <h2 className={cn("text-lg font-semibold text-dark dark:text-white", description ? "mb-2" : "mb-4", titleClassName)}>{title}</h2>
      )}
      {description && <p className={cn("text-sm text-dark-5", children ? "mb-4" : "")}>{description}</p>}
      {children}
    </section>
  );
}

export function FieldLabel({ htmlFor, children, hint }: { htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-dark dark:text-white">
        {children}
      </label>
      {hint && <p className="mt-0.5 text-xs text-dark-5">{hint}</p>}
    </div>
  );
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-base font-semibold text-dark dark:text-white">{children}</h3>;
}

/** Chips-in-a-box multi-select (content languages, niches, banned punctuation). */
export function MultiSelectDropdown({
  label,
  placeholder,
  options,
  selected,
  onChange,
  disabled,
}: {
  label: string;
  placeholder: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const toggle = (option: string) =>
    onChange(selected.includes(option) ? selected.filter((s) => s !== option) : options.filter((o) => o === option || selected.includes(o)));
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Popover
        className="w-full"
        panelClassName="w-full max-h-72 overflow-y-auto"
        trigger={({ open, toggle: toggleOpen }) => (
          <div
            onClick={() => !disabled && toggleOpen()}
            className={cn(
              "flex min-h-[46px] w-full cursor-pointer items-center gap-2 rounded-lg border border-stroke bg-white px-3 py-2 text-sm transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 dark:border-white/15 dark:bg-transparent",
              open && "border-primary",
              disabled && "cursor-not-allowed opacity-70",
            )}
          >
            <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
              {selected.length === 0 && <span className="px-1 text-dark-5">{placeholder}</span>}
              {selected.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-sm text-dark dark:bg-white/10 dark:text-white"
                >
                  <button
                    type="button"
                    aria-label={`Remove ${s}`}
                    disabled={disabled}
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange(selected.filter((x) => x !== s));
                    }}
                    className="rounded text-dark-5 hover:text-dark dark:hover:text-white"
                  >
                    <X className="size-3.5" />
                  </button>
                  {s}
                </span>
              ))}
            </div>
            <button
              id={id}
              type="button"
              disabled={disabled}
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-label={`${label}: ${selected.length ? selected.join(", ") : placeholder}`}
              onClick={(e) => {
                e.stopPropagation();
                toggleOpen();
              }}
              className="rounded-md p-0.5 text-dark outline-none focus-visible:ring-2 focus-visible:ring-primary/30 dark:text-white"
            >
              <ChevronDown className={cn("size-5 flex-shrink-0 transition-transform", open && "rotate-180")} />
            </button>
          </div>
        )}
      >
        <div role="listbox" aria-multiselectable="true" aria-label={label}>
          {options.map((o) => {
            const on = selected.includes(o);
            return (
              <button
                key={o}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => toggle(o)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-dark hover:bg-gray-100 dark:text-white dark:hover:bg-white/10"
              >
                <span
                  className={cn(
                    "flex size-4 flex-shrink-0 items-center justify-center rounded border",
                    on ? "border-primary bg-primary text-white" : "border-gray-300 dark:border-white/30",
                  )}
                >
                  {on && <Check className="size-3" strokeWidth={3} />}
                </span>
                {o}
              </button>
            );
          })}
        </div>
      </Popover>
    </div>
  );
}

/** Free-text pills: type and press Enter or comma (banned words, topics). */
export function PillListInput({
  id,
  values,
  onChange,
  placeholder,
  disabled,
  normalize = (v) => v.trim(),
  max,
}: {
  id?: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  disabled?: boolean;
  normalize?: (value: string) => string;
  max?: number;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const commit = () => {
    const v = normalize(draft.replace(/,+$/, ""));
    setDraft("");
    if (!v || values.includes(v) || (max != null && values.length >= max)) return;
    onChange([...values, v]);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === "," || e.key === "Tab") && draft.trim()) {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !draft && values.length) {
      e.preventDefault();
      onChange(values.slice(0, -1));
    }
  };
  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className="flex min-h-11 w-full cursor-text flex-wrap items-center gap-2 rounded-lg border border-stroke bg-white px-3 py-2 text-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 dark:border-white/15 dark:bg-transparent"
    >
      {values.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-dark dark:bg-white/10 dark:text-white">
          {v}
          <button
            type="button"
            disabled={disabled}
            aria-label={`Remove ${v}`}
            onClick={(e) => {
              e.stopPropagation();
              onChange(values.filter((x) => x !== v));
            }}
            className="rounded px-0.5 text-dark-5 hover:text-dark dark:hover:text-white"
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={id}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && commit()}
        placeholder={values.length ? "" : placeholder}
        className="min-w-[160px] flex-1 border-0 bg-transparent p-0 text-sm text-dark outline-none placeholder:text-dark-5 dark:text-white"
      />
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
        checked ? "bg-primary dark:bg-sky-600" : "bg-gray-200 dark:bg-white/15",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition duration-200",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

const THUMB = 16;
const rangeInput =
  "pointer-events-none absolute inset-0 h-5 w-full cursor-pointer appearance-none bg-transparent focus:outline-none disabled:cursor-not-allowed " +
  "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow " +
  "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-primary " +
  "focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-primary/40 dark:[&::-webkit-slider-thumb]:bg-sky-500";

// Thumb-centre position for value p (0–100%), matching where the native thumb sits.
const at = (pct: number) => `calc(${pct}% + ${(0.5 - pct / 100) * THUMB}px)`;

function SliderFrame({ min, max, label, children }: { min: number; max: number; label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-stroke bg-white px-3 pb-3 pt-2 dark:border-white/15 dark:bg-transparent">
      <div className="mb-2 flex items-center justify-between text-xs text-dark-5">
        <span>{min}</span>
        <span className="text-sm font-semibold text-dark dark:text-white">{label}</span>
        <span>{max}</span>
      </div>
      <div className="relative h-5">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gray-200 dark:bg-white/10" />
        {children}
      </div>
    </div>
  );
}

export function SingleSlider({
  id,
  min,
  max,
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  id?: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <SliderFrame min={min} max={max} label={String(value)}>
      <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary dark:bg-sky-500" style={{ left: 0, width: at(pct) }} />
      <input
        id={id}
        type="range"
        aria-label={ariaLabel}
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className={rangeInput}
      />
    </SliderFrame>
  );
}

export function RangeSlider({
  min,
  max,
  low,
  high,
  onChange,
  disabled,
  ariaLabel,
}: {
  min: number;
  max: number;
  low: number;
  high: number;
  onChange: (low: number, high: number) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  // When both thumbs sit together, keep the one that can still move on top.
  const lowOnTop = low === high && low > (min + max) / 2;
  return (
    <SliderFrame min={min} max={max} label={low === high ? String(low) : `${low} - ${high}`}>
      <div
        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary dark:bg-sky-500"
        style={{ left: at(pct(low)), width: `calc(${at(pct(high))} - ${at(pct(low))})` }}
      />
      <input
        type="range"
        aria-label={`${ariaLabel} minimum`}
        min={min}
        max={max}
        value={low}
        disabled={disabled}
        onChange={(e) => onChange(Math.min(Number(e.target.value), high), high)}
        className={rangeInput}
        style={{ zIndex: lowOnTop ? 2 : 1 }}
      />
      <input
        type="range"
        aria-label={`${ariaLabel} maximum`}
        min={min}
        max={max}
        value={high}
        disabled={disabled}
        onChange={(e) => onChange(low, Math.max(Number(e.target.value), low))}
        className={rangeInput}
      />
    </SliderFrame>
  );
}

/** Square checkbox used in the Data sources lists. */
export function CheckSquare({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        "flex size-5 flex-shrink-0 items-center justify-center rounded border",
        checked ? "border-primary bg-primary text-white dark:border-sky-500 dark:bg-sky-600" : "border-stroke dark:border-white/20",
      )}
    >
      {checked && <Check className="size-3.5" strokeWidth={3} />}
    </span>
  );
}
