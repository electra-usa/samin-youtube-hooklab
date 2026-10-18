"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import { CLICK_TRIGGERS, PERFORMANCE_TIERS, PUBLISH_DATE_WINDOWS, TITLE_FORMATS, TRIGGER_PILL_CLASSES, triggerColor } from "@/lib/taxonomy";
import {
  SORTED_NICHES,
  SUBSCRIBER_STEPS,
  TITLE_LENGTH_STEPS,
  VIEWS_STEPS,
  subscribersLabel,
  viewsLabel,
  type OutlierFilters,
  type VideoType,
} from "@/lib/research/filters";
import type { HiddenChannel } from "@/lib/research/types";
import { cn } from "@/lib/format";
import { CheckBox, MUTED } from "./controls";
import { IncExcRow } from "./FilterDropdowns";
import { RangeSlider } from "./RangeSlider";

function Section({ title, children, sectionRef }: { title: string; children: ReactNode; sectionRef?: RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={sectionRef} className="border-b border-stroke py-5 last:border-b-0 dark:border-white/10">
      <h3 className="mb-3 text-base font-semibold text-dark dark:text-white">{title}</h3>
      {children}
    </div>
  );
}

function CheckRow({ checked, onClick, children }: { checked: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-lg py-2 text-left transition hover:bg-gray-50 dark:hover:bg-white/5">
      <CheckBox checked={checked} />
      <span className="min-w-0 text-sm text-dark dark:text-white">{children}</span>
    </button>
  );
}

function IncExcColumns({ show }: { show: boolean }) {
  return (
    <div className="sticky top-0 z-10 mb-1 flex items-center gap-3 bg-white py-1 text-xs font-semibold text-dark dark:bg-[#1b1c1f] dark:text-white">
      <span className="flex-1" />
      {show && (
        <>
          <span className="w-7 text-center">Incl.</span>
          <span className="w-7 text-center">Excl.</span>
        </>
      )}
    </div>
  );
}

/** Include/exclude list that shows 6 options until "More" (two columns when expanded). */
function IncExcList({
  items,
  included,
  excluded,
  onInclude,
  onExclude,
  colored,
  onCollapse,
}: {
  items: string[];
  included: string[];
  excluded: string[];
  onInclude: (v: string) => void;
  onExclude: (v: string) => void;
  colored?: boolean;
  onCollapse?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, 6);
  const half = Math.ceil(shown.length / 2);
  const columns = expanded ? [shown.slice(0, half), shown.slice(half)] : [shown];
  return (
    <div>
      <div className={expanded ? "grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2" : ""}>
        {columns.map((col, i) => (
          <div key={i}>
            <IncExcColumns show />
            <div className="space-y-1">
              {col.map((item) => (
                <IncExcRow
                  key={item}
                  name={item}
                  label={
                    colored ? <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", TRIGGER_PILL_CLASSES[triggerColor(item)])}>{item}</span> : item
                  }
                  included={included.includes(item)}
                  excluded={excluded.includes(item)}
                  onInclude={() => onInclude(item)}
                  onExclude={() => onExclude(item)}
                  className="py-1"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      {items.length > 6 && (
        <button
          type="button"
          onClick={() => {
            if (expanded) onCollapse?.();
            setExpanded((e) => !e);
          }}
          className="mt-2 text-sm font-medium text-accent-blue-text hover:underline"
        >
          {expanded ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

export function AllFiltersModal({
  open,
  onClose,
  filters,
  onChange,
  onIncludeTrigger,
  onExcludeTrigger,
  onIncludeNiche,
  onExcludeNiche,
  onToggleTier,
  onIncludeDate,
  onExcludeDate,
  onClear,
  onSaveDefault,
  savingDefault,
  isDefault,
  hiddenChannels,
  onUnhide,
}: {
  open: boolean;
  onClose: () => void;
  filters: OutlierFilters;
  onChange: (patch: Partial<OutlierFilters>) => void;
  onIncludeTrigger: (v: string) => void;
  onExcludeTrigger: (v: string) => void;
  onIncludeNiche: (v: string) => void;
  onExcludeNiche: (v: string) => void;
  onToggleTier: (id: string) => void;
  onIncludeDate: (id: string) => void;
  onExcludeDate: (id: string) => void;
  onClear: () => void;
  onSaveDefault: () => void;
  savingDefault: boolean;
  isDefault: boolean;
  hiddenChannels: HiddenChannel[];
  onUnhide: (channelId: string) => void;
}) {
  const nicheRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const f = filters;
  const scrollTo = (ref: RefObject<HTMLDivElement | null>) => requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  const setType = (videoType: VideoType) => onChange({ videoType });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="all-filters-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-[#1b1c1f]"
      >
        <div className="flex items-center justify-between border-b border-stroke px-6 py-5 dark:border-white/10">
          <div>
            <h2 id="all-filters-title" className="text-lg font-bold text-dark dark:text-white">
              All filters
            </h2>
            <p className={cn("text-sm", MUTED)}>Choose the filters you want to apply.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="flex size-10 items-center justify-center rounded-full bg-gray-100 text-dark transition hover:bg-gray-200 dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6">
          <Section title="Video type">
            <div className="flex gap-2">
              {(["longform", "shorts"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  aria-pressed={f.videoType === t}
                  className={cn(
                    "rounded-lg border px-4 py-2 text-sm font-medium transition",
                    f.videoType === t
                      ? "border-primary bg-primary/10 text-primary dark:border-sky-400/60 dark:text-white"
                      : "border-stroke text-dark hover:bg-gray-50 dark:border-white/10 dark:text-white dark:hover:bg-white/5",
                  )}
                >
                  {t === "longform" ? "Long-form" : "Shorts"}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Outlier Score">
            <div className="space-y-1">
              {PERFORMANCE_TIERS.map((t) => (
                <CheckRow key={t.id} checked={f.selectedTierIds.includes(t.id)} onClick={() => onToggleTier(t.id)}>
                  <span className="inline-flex items-center gap-3">
                    <span className={cn("inline-block size-2.5 shrink-0 rounded-full", t.dotClass)} aria-hidden />
                    <span>
                      {t.label} <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", t.badgeClass)}>{t.scoreLabel}</span>
                    </span>
                  </span>
                </CheckRow>
              ))}
            </div>
          </Section>

          <Section title="Date">
            <IncExcColumns show />
            <div className="space-y-1">
              {PUBLISH_DATE_WINDOWS.filter((w) => w.id !== "all").map((w) => (
                <IncExcRow
                  key={w.id}
                  label={w.label}
                  included={f.publishDate === w.id}
                  excluded={f.excludedPublishDate === w.id}
                  onInclude={() => onIncludeDate(f.publishDate === w.id ? "all" : w.id)}
                  onExclude={() => onExcludeDate(f.excludedPublishDate === w.id ? "all" : w.id)}
                  className="py-1"
                />
              ))}
            </div>
          </Section>

          <Section title="Niche" sectionRef={nicheRef}>
            <IncExcList
              items={SORTED_NICHES}
              included={f.selectedNiches}
              excluded={f.excludedNiches}
              onInclude={onIncludeNiche}
              onExclude={onExcludeNiche}
              onCollapse={() => scrollTo(nicheRef)}
            />
          </Section>

          <Section title="Click Trigger" sectionRef={triggerRef}>
            <IncExcList
              items={CLICK_TRIGGERS}
              included={f.selectedClickTriggers}
              excluded={f.excludedClickTriggers}
              onInclude={onIncludeTrigger}
              onExclude={onExcludeTrigger}
              colored
              onCollapse={() => scrollTo(triggerRef)}
            />
          </Section>

          <Section title="Views">
            <p className={cn("mb-2 text-xs font-medium", MUTED)}>
              Views: {viewsLabel(f.viewsMin)} - {viewsLabel(f.viewsMax)}
            </p>
            <RangeSlider label="Views" steps={VIEWS_STEPS} min={f.viewsMin} max={f.viewsMax} format={viewsLabel} onChange={(viewsMin, viewsMax) => onChange({ viewsMin, viewsMax })} />
          </Section>

          <Section title="Subscribers">
            <p className={cn("mb-2 text-xs font-medium", MUTED)}>
              Subscribers: {subscribersLabel(f.subscriberMin)} - {subscribersLabel(f.subscriberMax)}
            </p>
            <RangeSlider
              label="Subscribers"
              steps={SUBSCRIBER_STEPS}
              min={f.subscriberMin}
              max={f.subscriberMax}
              format={subscribersLabel}
              onChange={(subscriberMin, subscriberMax) => onChange({ subscriberMin, subscriberMax })}
            />
          </Section>

          <Section title="Title Format">
            <div className="grid grid-cols-1 gap-x-5 gap-y-1 sm:grid-cols-2">
              {TITLE_FORMATS.map((t) => (
                <CheckRow
                  key={t}
                  checked={f.selectedTitleFormats.includes(t)}
                  onClick={() =>
                    onChange({
                      selectedTitleFormats: f.selectedTitleFormats.includes(t) ? f.selectedTitleFormats.filter((x) => x !== t) : [...f.selectedTitleFormats, t],
                    })
                  }
                >
                  {t}
                </CheckRow>
              ))}
            </div>
          </Section>

          <Section title="Title Length">
            <p className={cn("mb-2 text-xs font-medium", MUTED)}>
              Title length: {f.titleLengthMin} - {f.titleLengthMax} chars
            </p>
            <RangeSlider
              label="Title length"
              steps={TITLE_LENGTH_STEPS}
              min={f.titleLengthMin}
              max={f.titleLengthMax}
              format={(n) => `${n}`}
              onChange={(titleLengthMin, titleLengthMax) => onChange({ titleLengthMin, titleLengthMax })}
            />
            {f.titleLengthMax < 75 && <p className={cn("mt-3 text-xs font-medium", MUTED)}>This may limit the number of videos you see.</p>}
          </Section>

          <Section title="Newsletter videos">
            <CheckRow
              checked={f.newsletterFeatured === "featured"}
              onClick={() => onChange({ newsletterFeatured: f.newsletterFeatured === "featured" ? "all" : "featured" })}
            >
              Show only videos featured in the newsletter
            </CheckRow>
            <CheckRow
              checked={f.newsletterFeatured === "not_featured"}
              onClick={() => onChange({ newsletterFeatured: f.newsletterFeatured === "not_featured" ? "all" : "not_featured" })}
            >
              Hide videos featured in the newsletter
            </CheckRow>
          </Section>

          <Section title="Hidden channels">
            {hiddenChannels.length > 0 ? (
              <div className="rounded-xl border border-stroke bg-gray-50 p-4 dark:border-white/10 dark:bg-white/5">
                <div className="max-h-20 overflow-y-auto pr-1">
                  <div className="flex flex-wrap gap-2">
                    {hiddenChannels.map((h) => (
                      <span
                        key={h.channelId}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary dark:border-sky-400/40 dark:bg-sky-400/15 dark:text-white"
                      >
                        <span className="max-w-[220px] truncate">{h.channelName}</span>
                        <button
                          type="button"
                          onClick={() => onUnhide(h.channelId)}
                          aria-label={`Unhide ${h.channelName}`}
                          className="-mr-1 flex size-5 shrink-0 items-center justify-center rounded-full transition hover:bg-primary/15"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className={cn("text-sm", MUTED)}>Use Hide on a video card to keep a channel out of Outliers.</p>
            )}
          </Section>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-stroke px-6 py-4 dark:border-white/10">
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg px-4 py-2 text-sm font-medium text-dark transition hover:bg-gray-100 dark:text-white dark:hover:bg-white/10"
          >
            Clear filters
          </button>
          <button
            type="button"
            onClick={onSaveDefault}
            disabled={savingDefault || isDefault}
            className="rounded-lg border border-stroke bg-white px-4 py-2 text-sm font-medium text-dark transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:bg-transparent dark:text-white"
          >
            {savingDefault ? "Saving..." : isDefault ? "Default saved" : "Save as default"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white transition hover:bg-primary/90"
          >
            Show videos
          </button>
        </div>
      </div>
    </div>
  );
}
