"use client";

import Link from "next/link";
import { Image as ImageIcon, Lightbulb, MonitorPlay, Pin } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import { toast } from "@/components/ui/Toaster";
import { cn } from "@/lib/format";
import { findVideoRef } from "@/lib/chat/format";
import type { AngleCard, ChatTitle, InspirationSource, ThumbnailText, VideoMap } from "@/lib/chat/types";
import { copyText } from "./client";
import { VideoRefTooltip } from "./VideoRefTooltip";

// Angle cards with title rows (layout and classes follow the original chat message component).

export type TitleHandlers = {
  onThumbnail?: (title: string) => void;
  onTogglePin?: (title: ChatTitle, card: { id: string; name: string }) => void;
  isPinned?: (title: ChatTitle) => boolean;
  onMore?: (card: AngleCard) => void;
};

export type LiveBatch = { titles: ChatTitle[]; stageLabel: string | null; slots: number };

const ICON_BTN =
  "inline-flex items-center justify-center rounded p-1 text-[var(--color-muted)] transition-colors hover:bg-gray-100 hover:text-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:bg-gray-700 dark:hover:text-white";

async function copyWithToast(text: string, label: string) {
  if (await copyText(text)) toast.success(label);
  else toast.error("Couldn't copy to the clipboard");
}

function Inspiration({ sources, videoMap }: { sources: InspirationSource[]; videoMap: VideoMap }) {
  const video = findVideoRef(videoMap, sources[0].title);
  const icon = <Lightbulb className="size-4 translate-y-px" />;
  if (video) {
    return (
      <VideoRefTooltip video={video} triggerClassName={ICON_BTN} label="Inspiration source">
        {icon}
      </VideoRefTooltip>
    );
  }
  return (
    <Tooltip
      content={
        <div className="space-y-1 text-left">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide opacity-70">Inspired by</p>
          {sources.map((s, i) => (
            <p key={i} className="text-xs leading-snug">
              “{s.title}” <span className="opacity-70">— {s.channelName}</span>
            </p>
          ))}
        </div>
      }
    >
      <button type="button" className={ICON_BTN} aria-label="Inspiration source">
        {icon}
      </button>
    </Tooltip>
  );
}

export function TitleRow({
  title,
  card,
  videoMap,
  handlers,
}: {
  title: ChatTitle;
  card: { id: string; name: string };
  videoMap: VideoMap;
  handlers: TitleHandlers;
}) {
  const pinned = handlers.isPinned?.(title) ?? false;
  return (
    <li className="flex min-w-0 items-start justify-between gap-2 text-sm">
      <button
        type="button"
        onClick={() => copyWithToast(title.title, "Title copied")}
        title="Click to copy title"
        aria-label={`Copy title: ${title.title}`}
        className="line-clamp-3 min-w-0 flex-1 cursor-pointer text-left font-normal leading-snug text-dark transition-colors hover:text-accent-blue-text dark:text-white dark:hover:text-accent-blue"
      >
        {title.title}
      </button>
      <span className="flex shrink-0 items-center gap-0.5">
        {handlers.onThumbnail && (
          <Tooltip content="Generate thumbnail text">
            <button type="button" className={ICON_BTN} aria-label={`Generate thumbnail text for title: ${title.title}`} onClick={() => handlers.onThumbnail?.(title.title)}>
              <ImageIcon className="size-4" />
            </button>
          </Tooltip>
        )}
        <Tooltip content="Preview in Studio">
          <Link href={`/studio?prefillTitle=${encodeURIComponent(title.title)}`} className={ICON_BTN} aria-label={`Preview in Studio: ${title.title}`}>
            <MonitorPlay className="size-4" />
          </Link>
        </Tooltip>
        {title.inspirationSources?.length ? <Inspiration sources={title.inspirationSources} videoMap={videoMap} /> : null}
        {handlers.onTogglePin && (
          <Tooltip content={pinned ? "Unpin this title" : "Pin this title"}>
            <button
              type="button"
              aria-label={pinned ? "Unpin this title" : "Pin this title"}
              onClick={() => handlers.onTogglePin?.(title, card)}
              className={cn(ICON_BTN, pinned ? "text-primary dark:text-white" : "hover:text-accent-blue-text")}
            >
              <Pin className="size-4" fill={pinned ? "currentColor" : "none"} />
            </button>
          </Tooltip>
        )}
      </span>
    </li>
  );
}

export function AngleCardView({
  card,
  videoMap,
  handlers,
  batches = [],
  live,
  building = false,
}: {
  card: AngleCard;
  videoMap: VideoMap;
  handlers: TitleHandlers;
  /** Saved "More titles" batches. */
  batches?: { batchIndex: number; titles: ChatTitle[] }[];
  /** A "More titles" batch that is streaming right now. */
  live?: LiveBatch | null;
  /** The card is still being written (streaming). */
  building?: boolean;
}) {
  const ref = { id: card.id, name: card.name };
  return (
    <div
      data-card-id={card.id}
      className={cn(
        "min-w-0 space-y-2 rounded-lg border p-3",
        card.isRecommended ? "brand-accent-blue-panel" : "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg" aria-hidden>
          {card.emoji}
        </span>
        <span className="font-medium text-dark dark:text-white">{card.name}</span>
        {card.isRecommended && <span className="brand-accent-blue-chip rounded px-1.5 py-0.5 text-xs">Recommended</span>}
      </div>
      {card.description && <p className="text-xs text-[var(--color-muted)]">{card.description}</p>}
      {card.isRecommended && card.recommendationReason && <p className="brand-accent-blue-chip rounded px-2 py-1.5 text-xs">{card.recommendationReason}</p>}
      <ul className="min-w-0 space-y-1.5">
        {card.titles.map((t) => (
          <TitleRow key={t.id} title={t} card={ref} videoMap={videoMap} handlers={handlers} />
        ))}
        {building && card.titles.length < 2 && <SkeletonRows count={2 - card.titles.length} />}
      </ul>
      {batches.map((b) => (
        <div key={b.batchIndex} className="border-t border-gray-200 pt-2 dark:border-gray-700">
          <ul className="min-w-0 space-y-1.5">
            {b.titles.map((t) => (
              <TitleRow key={t.id} title={t} card={ref} videoMap={videoMap} handlers={handlers} />
            ))}
          </ul>
        </div>
      ))}
      {live && (
        <div className="border-t border-gray-200 pt-2 dark:border-gray-700">
          {live.stageLabel && <p className="mb-1.5 animate-pulse text-xs text-[var(--color-muted)]">{live.stageLabel}</p>}
          <ul className="min-w-0 space-y-1.5">
            {live.titles.map((t) => (
              <TitleRow key={t.id} title={t} card={ref} videoMap={videoMap} handlers={handlers} />
            ))}
            <SkeletonRows count={Math.max(0, live.slots - live.titles.length)} />
          </ul>
        </div>
      )}
      {handlers.onMore && !building && (
        <button
          type="button"
          onClick={() => handlers.onMore?.(card)}
          disabled={!!live}
          className="mt-1 rounded-full border border-gray-300 px-2.5 py-1 text-xs text-dark transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-white dark:hover:bg-gray-700"
        >
          {live ? "Loading..." : "More titles →"}
        </button>
      )}
    </div>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <li key={`skeleton-${i}`} className="flex items-center gap-2 text-sm">
          <span className="h-4 flex-1 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        </li>
      ))}
    </>
  );
}

export function ThumbnailTextList({ items, videoMap }: { items: ThumbnailText[]; videoMap: VideoMap }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">Thumbnail text</p>
      <ul className="space-y-2">
        {items.map((t) => (
          <li key={t.id} className="rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-800/50">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => copyWithToast(t.text, "Thumbnail text copied")}
                title="Click to copy thumbnail text"
                className="min-w-0 flex-1 cursor-pointer text-left text-sm text-dark transition-colors hover:text-accent-blue-text dark:text-white"
              >
                {t.text}
              </button>
              {t.inspirationSources?.length ? <Inspiration sources={t.inspirationSources} videoMap={videoMap} /> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
