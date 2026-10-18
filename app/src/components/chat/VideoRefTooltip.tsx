"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ExternalLink } from "lucide-react";
import { tierForScore } from "@/lib/taxonomy";
import { cn, timeAgo } from "@/lib/format";
import type { VideoRef } from "@/lib/chat/types";

// Hover card for a library video cited in a reply: thumbnail, title, channel, outlier score,
// views and age (same content as the original's VideoRefTooltip).

function useHoverCard(width = 280) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width });
  const anchor = useRef<HTMLSpanElement>(null);
  const card = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const place = useCallback(() => {
    const el = anchor.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = Math.min(width, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const h = card.current?.offsetHeight ?? 240;
    const below = r.bottom + 6;
    const top = below + h <= window.innerHeight - 8 ? below : Math.max(8, r.top - h - 6);
    setPos({ top, left, width: w });
  }, [width]);

  useEffect(() => {
    if (!open) return;
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), 250);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 120);
  };
  return { open, setOpen, pos, anchor, card, show, hide };
}

export function VideoRefCard({ video }: { video: VideoRef }) {
  const score = video.outlierScore ? parseFloat(video.outlierScore) : null;
  const tier = tierForScore(score);
  return (
    <span className="group/vref flex w-full flex-col overflow-hidden rounded-lg border border-stroke bg-white shadow-xl dark:border-dark-3 dark:bg-[#1b1c1f]">
      <span className="relative block aspect-video overflow-hidden bg-[#e8e8e8] dark:bg-dark-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`} alt="" className="h-full w-full object-cover" loading="lazy" />
        <a
          href={`https://www.youtube.com/watch?v=${video.videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open on YouTube"
          className="absolute right-2 top-2 rounded-md bg-black/70 p-1 text-white opacity-0 transition-opacity group-hover/vref:opacity-100"
        >
          <ExternalLink className="size-3.5" />
        </a>
      </span>
      <span className="flex flex-col gap-1 p-2.5">
        <span className="font-roboto line-clamp-2 text-[13px] font-medium leading-snug text-dark dark:text-white">{video.title}</span>
        {video.channelName && <span className="font-roboto truncate text-xs text-[var(--color-muted)]">{video.channelName}</span>}
        <span className="font-roboto flex flex-wrap items-center gap-1 text-xs text-[var(--color-muted)]">
          {video.outlierScore && (
            <span className={cn("rounded px-1.5 py-0.5 font-medium", tier?.badgeClass ?? "bg-gray-500/10 text-gray-500")}>
              {score != null && score >= 999 ? "999x+" : video.outlierScore}
            </span>
          )}
          <span>
            {video.outlierScore ? "· " : ""}
            {video.views} views{video.publishedAt ? ` · ${timeAgo(video.publishedAt)}` : ""}
          </span>
        </span>
      </span>
    </span>
  );
}

export function VideoRefTooltip({
  video,
  children,
  triggerClassName,
  label,
}: {
  video: VideoRef;
  children: ReactNode;
  triggerClassName?: string;
  label?: string;
}) {
  const { open, setOpen, pos, anchor, card, show, hide } = useHoverCard();
  return (
    <span ref={anchor} className="relative inline" onMouseEnter={show} onMouseLeave={hide}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className={
          triggerClassName ??
          "rounded border-b border-dotted border-accent-blue/50 text-left font-medium text-dark transition-colors hover:border-primary dark:text-white"
        }
      >
        {children}
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <span ref={card} onMouseEnter={show} onMouseLeave={hide} className="fixed z-[70] block" style={{ top: pos.top, left: pos.left, width: pos.width }}>
            <VideoRefCard video={video} />
          </span>,
          document.body,
        )}
    </span>
  );
}

type ChannelCard = { channelId: string; channelName: string; subscriberCount: number | null; recentVideos: VideoRef[] };
const channelCache = new Map<string, Promise<ChannelCard | null>>();

function loadChannel(id: string): Promise<ChannelCard | null> {
  if (!channelCache.has(id)) {
    channelCache.set(
      id,
      fetch(`/api/chat/channel-cards?ids=${encodeURIComponent(id)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((r: { data: ChannelCard[] }) => r.data[0] ?? null)
        .catch(() => null),
    );
  }
  return channelCache.get(id)!;
}

/** cref:<channelId> link: hover shows the channel's latest library videos. */
export function ChannelRefLink({ channelId, children }: { channelId: string; children: ReactNode }) {
  const { open, pos, anchor, card: cardRef, show, hide } = useHoverCard(300);
  const [card, setCard] = useState<ChannelCard | null | undefined>(undefined);
  useEffect(() => {
    if (open && card === undefined) loadChannel(channelId).then(setCard);
  }, [open, card, channelId]);
  return (
    <span ref={anchor} className="relative inline" onMouseEnter={show} onMouseLeave={hide}>
      <a
        href={`https://www.youtube.com/channel/${channelId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded border-b border-dotted border-accent-blue/50 font-medium text-dark hover:border-primary dark:text-white"
      >
        {children}
      </a>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <span ref={cardRef} onMouseEnter={show} onMouseLeave={hide} className="fixed z-[70] block" style={{ top: pos.top, left: pos.left, width: pos.width }}>
            <span className="block rounded-lg border border-stroke bg-white p-3 text-sm shadow-xl dark:border-dark-3 dark:bg-[#1b1c1f]">
              {card === undefined && <span className="text-xs text-dark-5">Loading channel…</span>}
              {card === null && <span className="text-xs text-dark-5">No library data for this channel.</span>}
              {card && (
                <span className="flex flex-col gap-2">
                  <span className="font-medium text-dark dark:text-white">
                    {card.channelName}
                    {card.subscriberCount ? <span className="ml-1 text-xs font-normal text-dark-5">· {Intl.NumberFormat("en", { notation: "compact" }).format(card.subscriberCount)} subs</span> : null}
                  </span>
                  {card.recentVideos.map((v) => (
                    <span key={v.videoId} className="font-roboto block text-xs text-dark dark:text-gray-200">
                      <span className="line-clamp-1">{v.title}</span>
                      <span className="text-[var(--color-muted)]">
                        {v.outlierScore} · {v.views} views{v.publishedAt ? ` · ${timeAgo(v.publishedAt)}` : ""}
                      </span>
                    </span>
                  ))}
                </span>
              )}
            </span>
          </span>,
          document.body,
        )}
    </span>
  );
}
