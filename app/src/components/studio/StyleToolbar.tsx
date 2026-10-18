"use client";

import { useEffect, useRef, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import { cn } from "@/lib/format";
import { STUDIO_FONT_OPTIONS, type StyleSettings, type TextAlign } from "./model";

const SWATCHES = ["#FFFFFF", "#000000", "#FFD60A", "#FF3B30", "#FF9500", "#34C759", "#0A84FF", "#AF52DE", "#B7FDA0", "#4F9DD1"];
const ALIGNS: TextAlign[] = ["left", "center", "right"];
const CONTROL =
  "h-9 rounded-md border border-stroke bg-white text-sm text-dark outline-none transition hover:border-primary focus:border-primary dark:border-white/15 dark:bg-white/5 dark:text-white";

function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value.toUpperCase());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          setDraft(value.toUpperCase());
          setOpen((v) => !v);
        }}
        title="Text color"
        aria-label="Text color"
        aria-expanded={open}
        className={cn(CONTROL, "flex w-9 flex-col items-center justify-center")}
      >
        <span className="text-sm font-semibold leading-none">A</span>
        <span
          className="mt-1 h-1 w-5 rounded-full"
          style={{ background: "linear-gradient(to right, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #4b0082, #9400d3)" }}
        />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-[208px] rounded-lg border border-stroke bg-white p-3 shadow-lg dark:border-white/10 dark:bg-[#1b1c1f]">
          <div className="grid grid-cols-5 gap-2">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Use ${c}`}
                onClick={() => {
                  onChange(c);
                  setDraft(c);
                }}
                className={cn(
                  "size-8 rounded-md border border-black/10 transition hover:scale-105 dark:border-white/20",
                  value.toUpperCase() === c && "ring-2 ring-primary ring-offset-1",
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs text-[var(--color-muted)]">
            <input
              type="color"
              value={/^#[0-9A-F]{6}$/i.test(value) ? value : "#ffffff"}
              onChange={(e) => {
                onChange(e.target.value.toUpperCase());
                setDraft(e.target.value.toUpperCase());
              }}
              className="h-8 w-10 cursor-pointer rounded border border-stroke bg-transparent p-0.5 dark:border-white/15"
            />
            Custom
          </label>
          <input
            type="text"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (/^#[0-9A-F]{6}$/i.test(e.target.value)) onChange(e.target.value.toUpperCase());
            }}
            placeholder="#FFFFFF"
            aria-label="Hex color"
            className="mt-2 w-full rounded border border-stroke bg-transparent px-2 py-1 text-center text-xs text-dark dark:border-white/15 dark:text-white"
          />
        </div>
      )}
    </div>
  );
}

/** Font, size, color and alignment for the thumbnail text (disabled until there is some). */
export function StyleToolbar({ settings, onChange, disabled }: { settings: StyleSettings; onChange: (s: StyleSettings) => void; disabled: boolean }) {
  const AlignIcon = settings.textAlign === "left" ? AlignLeft : settings.textAlign === "right" ? AlignRight : AlignCenter;
  return (
    <div className={disabled ? "group relative" : "relative"}>
      {disabled && (
        <>
          <div className="absolute inset-0 z-10 cursor-default rounded-lg" />
          <div className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-dark px-3 py-1.5 text-xs text-white shadow-md group-hover:block dark:bg-white dark:text-dark">
            Add thumbnail text to use these tools
          </div>
        </>
      )}
      <div
        className={cn(
          "flex flex-wrap items-center justify-center gap-1.5 rounded-lg border border-stroke bg-[#F8F8F8] p-2 shadow-sm dark:border-white/10 dark:bg-[#18191c]",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <select
          value={settings.font}
          onChange={(e) => onChange({ ...settings, font: e.target.value })}
          title="Font family"
          aria-label="Font family"
          className={cn(CONTROL, "appearance-none px-2.5 pr-6")}
        >
          {STUDIO_FONT_OPTIONS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={12}
          max={200}
          value={settings.fontSize}
          onChange={(e) => onChange({ ...settings, fontSize: Math.max(12, Math.min(200, parseInt(e.target.value, 10) || 30)) })}
          title="Font size"
          aria-label="Font size"
          className={cn(CONTROL, "w-16 px-2.5 text-center")}
        />
        <ColorPicker value={settings.fontColor} onChange={(fontColor) => onChange({ ...settings, fontColor })} />
        <button
          type="button"
          onClick={() => onChange({ ...settings, textAlign: ALIGNS[(ALIGNS.indexOf(settings.textAlign) + 1) % ALIGNS.length] })}
          title={`Text align: ${settings.textAlign} (click to cycle)`}
          aria-label={`Text align: ${settings.textAlign}`}
          className={cn(CONTROL, "flex w-9 items-center justify-center")}
        >
          <AlignIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}
