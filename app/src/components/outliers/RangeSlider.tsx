"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

// Two-thumb slider that snaps to a fixed scale of steps (views, subscribers, title length).
// Header shows the scale ends and the selected range, like the original's range control.

function nearestIndex(steps: number[], value: number) {
  let best = 0;
  for (let i = 1; i < steps.length; i++) if (Math.abs(steps[i] - value) < Math.abs(steps[best] - value)) best = i;
  return best;
}

export function RangeSlider({
  steps,
  min,
  max,
  onChange,
  format,
  label,
}: {
  steps: number[];
  min: number;
  max: number;
  onChange: (min: number, max: number) => void;
  format: (n: number) => string;
  label: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<"min" | "max" | null>(null);
  const lo = nearestIndex(steps, min);
  const hi = Math.max(lo, nearestIndex(steps, max));
  const pct = (i: number) => (steps.length <= 1 ? 0 : (i / (steps.length - 1)) * 100);
  const range = useRef({ lo, hi });
  useEffect(() => {
    range.current = { lo, hi };
  }, [lo, hi]);

  const indexAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(ratio * (steps.length - 1));
  };

  const apply = (thumb: "min" | "max", index: number) => {
    const { lo: curLo, hi: curHi } = range.current;
    if (thumb === "min") {
      const next = Math.min(index, curHi);
      if (next !== curLo) onChange(steps[next], steps[curHi]);
    } else {
      const next = Math.max(index, curLo);
      if (next !== curHi) onChange(steps[curLo], steps[next]);
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const index = indexAt(e.clientX);
    const { lo: curLo, hi: curHi } = range.current;
    const thumb = Math.abs(index - curLo) <= Math.abs(index - curHi) && !(index > curHi) ? "min" : "max";
    setDrag(thumb);
    e.currentTarget.setPointerCapture(e.pointerId);
    apply(thumb, index);
  };

  const onKey = (thumb: "min" | "max") => (e: KeyboardEvent) => {
    const delta = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const { lo: curLo, hi: curHi } = range.current;
    apply(thumb, Math.min(steps.length - 1, Math.max(0, (thumb === "min" ? curLo : curHi) + delta)));
  };

  const current = lo === hi ? format(steps[lo]) : `${format(steps[lo])} - ${format(steps[hi])}`;
  return (
    <div className="flex w-full min-w-0 flex-col gap-2 rounded-lg border border-stroke bg-white px-4 py-2.5 dark:border-white/10 dark:bg-[#18191c]">
      <div className="flex items-center justify-between text-xs text-dark-5 dark:text-gray-400">
        <span>{format(steps[0])}</span>
        <span className="font-medium text-dark dark:text-white">{current}</span>
        <span>{format(steps[steps.length - 1])}</span>
      </div>
      <div
        ref={trackRef}
        className="relative h-11 cursor-pointer touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={(e) => drag && apply(drag, indexAt(e.clientX))}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
      >
        <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-gray-100 dark:bg-white/10" />
        <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-primary dark:bg-sky-600" style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }} />
        {(["min", "max"] as const).map((thumb) => (
          <div
            key={thumb}
            role="slider"
            tabIndex={0}
            aria-label={`${label} ${thumb === "min" ? "minimum" : "maximum"}`}
            aria-valuemin={steps[0]}
            aria-valuemax={steps[steps.length - 1]}
            aria-valuenow={steps[thumb === "min" ? lo : hi]}
            aria-valuetext={format(steps[thumb === "min" ? lo : hi])}
            onKeyDown={onKey(thumb)}
            className="absolute top-1/2 z-10 flex size-11 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center outline-none active:cursor-grabbing [&:focus-visible>span]:ring-2 [&:focus-visible>span]:ring-primary"
            style={{ left: `${pct(thumb === "min" ? lo : hi)}%` }}
          >
            <span className="size-4 rounded-full border-2 border-white bg-primary shadow-md dark:border-[#18191c] dark:bg-sky-500" />
          </div>
        ))}
      </div>
    </div>
  );
}
