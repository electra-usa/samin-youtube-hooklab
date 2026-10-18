"use client";

import type { ReactNode } from "react";
import { cn, formatDuration, formatSubs, formatViews, parseIsoDuration, timeAgo } from "@/lib/format";
import { OutlierBadge } from "./OutlierBadge";
import { TriggerChips } from "./TriggerChips";

/** The fields every video surface shares (Outliers, Following, Bookmarks, My Channel, Studio). */
export type CardVideo = {
  id?: string;
  videoId: string;
  title: string;
  thumbnail?: string | null;
  videoUrl?: string | null;
  channelId?: string | null;
  channelName?: string | null;
  subscriberCount?: number | null;
  views?: number | null;
  outlierScore?: number | null;
  publishAt?: string | null;
  duration?: string | null;
  durationSeconds?: number | null;
  clickTriggers?: string[];
};

// Card layout matches the original's structure (evidence/screens/outliers.outline.json).
export function VideoCard({
  video,
  href,
  scoreContext = "channel",
  showChannel = true,
  channelActions,
  hoverActions,
  menu,
  footer,
  onChannelClick,
  onTriggerClick,
  activeTriggers,
  aspect = "video",
  pinStats = true,
  className,
}: {
  video: CardVideo;
  /** Where the title and thumbnail link to (defaults to YouTube). */
  href?: string;
  scoreContext?: "channel" | "mine";
  showChannel?: boolean;
  /** Follow / Hide pills next to the channel name. */
  channelActions?: ReactNode;
  /** Icon buttons revealed on hover in the thumbnail's top-right corner. */
  hoverActions?: ReactNode;
  /** The "•••" menu at the end of the stats row. */
  menu?: ReactNode;
  /** Extra row under the stats (e.g. the "generate titles" pencil on My Channel). */
  footer?: ReactNode;
  onChannelClick?: (channelId: string, channelName: string) => void;
  onTriggerClick?: (trigger: string) => void;
  activeTriggers?: string[];
  /** "short" renders a 9:16 thumbnail for Shorts. */
  aspect?: "video" | "short";
  /** Keep the stats row at the bottom of equal-height cards (default) or let it follow the title. */
  pinStats?: boolean;
  className?: string;
}) {
  const link = href ?? video.videoUrl ?? `https://www.youtube.com/watch?v=${video.videoId}`;
  const external = !href;
  const seconds = video.durationSeconds ?? parseIsoDuration(video.duration);
  const thumb = video.thumbnail ?? `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`;

  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-lg border border-stroke bg-white hover:z-10 dark:border-dark-3 dark:bg-[#18191c]",
        className,
      )}
    >
      <div className="relative overflow-hidden rounded-t-lg">
        <a href={link} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined} className="block">
          <div className={cn("relative w-full overflow-hidden bg-[#e8e8e8] dark:bg-dark-3", aspect === "short" ? "aspect-[9/16]" : "aspect-video")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumb} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition group-hover:opacity-95" />
            {seconds > 0 && (
              <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium text-white">
                {formatDuration(seconds)}
              </span>
            )}
          </div>
        </a>
        {hoverActions && (
          <div className="absolute right-2 top-2 z-10 flex flex-col gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
            {hoverActions}
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <a
          href={link}
          target={external ? "_blank" : undefined}
          rel={external ? "noreferrer" : undefined}
          title={video.title}
          className="font-roboto line-clamp-2 text-sm font-medium text-dark hover:underline dark:text-white"
        >
          {video.title}
        </a>

        {showChannel && video.channelName && (
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="font-roboto flex min-w-0 items-center gap-[0.25em] text-xs text-[var(--color-muted)]">
              <button
                type="button"
                onClick={() => video.channelId && onChannelClick?.(video.channelId, video.channelName ?? "")}
                className="min-w-0 cursor-pointer truncate text-left transition-colors hover:text-accent-blue-text"
              >
                {video.channelName}
              </button>
              {video.subscriberCount != null && <span className="flex-shrink-0">· {formatSubs(video.subscriberCount)}</span>}
            </div>
            {channelActions}
          </div>
        )}

        <div className={cn("font-roboto flex items-center gap-1 text-xs text-[var(--color-muted)]", pinStats && "mt-auto")}>
          {video.outlierScore != null && (
            <>
              <OutlierBadge score={video.outlierScore} context={scoreContext} />
              <span>·</span>
            </>
          )}
          <span className="truncate">
            {formatViews(video.views)}
            {video.publishAt ? ` · ${timeAgo(video.publishAt)}` : ""}
          </span>
          {menu && <span className="ml-auto flex items-center gap-0.5">{menu}</span>}
        </div>

        {video.clickTriggers && video.clickTriggers.length > 0 && (
          <TriggerChips triggers={video.clickTriggers} onSelect={onTriggerClick} activeTriggers={activeTriggers} />
        )}
        {footer}
      </div>
    </div>
  );
}

/** Small round pill used for Follow / Hide next to channel names. */
export function ChannelPill({
  children,
  onClick,
  tone = "neutral",
  active,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "neutral" | "danger";
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex-shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50",
        active
          ? "border-accent-blue-text bg-accent-blue/10 text-accent-blue-text"
          : "border-stroke bg-white text-dark-5 dark:bg-transparent dark:border-white/15",
        tone === "danger" ? "hover:border-red-500 hover:text-red-500" : "hover:border-accent-blue-text hover:text-accent-blue-text",
      )}
    >
      {children}
    </button>
  );
}

/** Dark translucent icon button for the thumbnail hover stack. */
export function ThumbAction({ label, onClick, href, children }: { label: string; onClick?: () => void; href?: string; children: ReactNode }) {
  const cls = "flex items-center justify-center rounded-md bg-black/70 p-1.5 text-white backdrop-blur-sm hover:bg-black/80";
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" aria-label={label} title={label} className={cls}>
      {children}
    </a>
  ) : (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={cls}>
      {children}
    </button>
  );
}
