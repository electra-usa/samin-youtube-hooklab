"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock3, ExternalLink, RefreshCw, Search, SquarePen, Trophy } from "lucide-react";
import { VideoCard, ThumbAction } from "@/components/video/VideoCard";
import { Tooltip } from "@/components/ui/Tooltip";
import { getJson } from "@/lib/api-client";
import { cn, formatCount, timeAgo } from "@/lib/format";
import { PERFORMANCE_TIERS } from "@/lib/taxonomy";
import type { ChannelSummary, MyChannelVideo, TimeFilter, VideoSort, VideoTab } from "@/lib/channel/videos";
import { ChannelHeader, outlineButtonClass } from "./ChannelHeader";
import { OutlierTierFilter } from "./OutlierTierFilter";
import { useChannelSync } from "./useChannelSync";

const PAGE_SIZE = 24;
/** The original stops auto-loading at 200 videos (also its API's maxTotal). */
const AUTO_LOAD_CAP = 200;

const TAB_LABELS: Record<VideoTab, string> = { longform: "Videos", shorts: "Shorts", livestreams: "Livestreams" };
const TIME_LABELS: Record<TimeFilter, string> = { all: "All time", "7": "Last 7 Days", "30": "Last 30 Days", "365": "Last Year" };
const TIME_FILTERS: TimeFilter[] = ["all", "7", "30", "365"];
const SORT_LABELS: Record<Exclude<VideoSort, "outlier">, string> = {
  latest: "Latest",
  oldest: "Oldest",
  popular: "Most views",
  unpopular: "Least views",
};
const SORTS = ["latest", "oldest", "popular", "unpopular"] as const;

type Page = { videos: MyChannelVideo[]; nextCursor: string | null; hasMore: boolean };

export function MyChannelView({ channel, renderedAt }: { channel: ChannelSummary; renderedAt: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<VideoTab>("longform");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [baseSort, setBaseSort] = useState<VideoSort>("latest");
  const [tiers, setTiers] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [videos, setVideos] = useState<MyChannelVideo[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const requestId = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);

  // Tabs disappear when the channel has no Shorts / livestreams.
  const activeTab: VideoTab =
    (tab === "shorts" && !channel.hasShorts) || (tab === "livestreams" && !channel.hasLivestreams) ? "longform" : tab;
  // A tier selection sorts by outlier score; time windows only rank by views gained.
  const sort: VideoSort =
    timeFilter !== "all" ? (baseSort === "unpopular" ? "unpopular" : "popular") : tiers.size ? "outlier" : baseSort;
  const scoreRange = useMemo(() => {
    if (!tiers.size || timeFilter !== "all") return null;
    const picked = PERFORMANCE_TIERS.filter((t) => tiers.has(t.id));
    return { min: Math.min(...picked.map((t) => t.min)), max: Math.max(...picked.map((t) => t.max)) };
  }, [tiers, timeFilter]);

  const sync = useChannelSync({
    userChannelId: channel.id,
    lastSyncedAt: channel.lastSyncedAt,
    renderedAt,
    onCompleted: () => {
      setReloadKey((k) => k + 1);
      router.refresh();
    },
  });

  // Debounced search (400 ms, as in the original).
  useEffect(() => {
    const value = searchInput.trim();
    const t = setTimeout(() => setSearch(value), value ? 400 : 0);
    return () => clearTimeout(t);
  }, [searchInput]);

  const buildUrl = useCallback(
    (cursor: string | null) => {
      const p = new URLSearchParams({
        limit: String(PAGE_SIZE),
        sort,
        timeFilter,
        type: activeTab,
        userChannelId: channel.id,
      });
      if (cursor) p.set("cursor", cursor);
      if (search) {
        p.set("search", search);
        p.set("searchMode", "exact");
      }
      if (scoreRange) {
        p.set("minScore", String(scoreRange.min));
        p.set("maxScore", String(scoreRange.max));
      }
      return `/api/my-channel/videos?${p}`;
    },
    [sort, timeFilter, activeTab, channel.id, search, scoreRange],
  );

  // First page whenever the query changes.
  useEffect(() => {
    const id = ++requestId.current;
    let done = false;
    const kick = setTimeout(() => {
      if (done) return;
      setLoading(true);
      setError(null);
    }, 0);
    getJson<{ data: Page }>(buildUrl(null), { cache: "no-store" })
      .then(({ data }) => {
        if (id !== requestId.current) return;
        setVideos(data.videos);
        setNextCursor(data.nextCursor);
        setHasMore(data.hasMore);
        setError(null);
      })
      .catch((err: unknown) => id === requestId.current && setError(err instanceof Error ? err.message : "Failed to load videos"))
      .finally(() => {
        done = true;
        if (id === requestId.current) setLoading(false);
      });
    return () => clearTimeout(kick);
  }, [buildUrl, reloadKey]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore || loading) return;
    const id = requestId.current;
    setLoadingMore(true);
    getJson<{ data: Page }>(buildUrl(nextCursor), { cache: "no-store" })
      .then(({ data }) => {
        if (id !== requestId.current) return;
        setVideos((prev) => {
          const seen = new Set(prev.map((v) => v.id));
          return [...prev, ...data.videos.filter((v) => !seen.has(v.id))];
        });
        setNextCursor(data.nextCursor);
        setHasMore(data.hasMore);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [nextCursor, loadingMore, loading, buildUrl]);

  // Infinite scroll up to the cap; "Load more videos" stays as the manual path.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || loadingMore || loading || !hasMore || videos.length >= AUTO_LOAD_CAP) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && loadMore(), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, loadingMore, loading, hasMore, videos.length]);

  const toggleTier = (id: string) =>
    setTiers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const changeTimeFilter = (f: TimeFilter) => {
    setTimeFilter(f);
    if (f !== "all") setTiers(new Set());
  };

  const daysTracked = channel.firstSnapshotDate
    ? Math.floor((Date.parse(renderedAt) - Date.parse(channel.firstSnapshotDate)) / 86_400_000)
    : 0;
  const tabs: VideoTab[] = ["longform", ...(channel.hasShorts ? ["shorts" as const] : []), ...(channel.hasLivestreams ? ["livestreams" as const] : [])];
  const showSkeleton = loading && videos.length === 0;

  const emptyMessage =
    activeTab === "livestreams"
      ? "No livestreams found. Sync your channel to detect livestreams."
      : activeTab === "shorts"
        ? "No Shorts found matching your filters."
        : sync.syncing
          ? "No videos yet. Syncing from YouTube to load your long-form videos."
          : channel.hasShorts || channel.hasLivestreams
            ? "No long-form videos found matching your filters."
            : "No long-form videos yet.";

  const generateTitles = (v: MyChannelVideo) => {
    const prompt = `Help me generate new title ideas for my video titled "${v.title}".`;
    router.push(`/chat?prompt=${encodeURIComponent(prompt)}`);
  };

  return (
    <div className="space-y-6">
      <ChannelHeader
        avatar={channel.channelAvatar}
        name={channel.channelName}
        meta={
          <>
            <a href={channel.channelUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
              View channel
            </a>
            {channel.subscriberCount != null && <span>{formatCount(channel.subscriberCount)} subscribers</span>}
            <span>{channel.videoCount} videos</span>
            {!sync.syncing && sync.state !== "failed" && (
              <button
                type="button"
                onClick={() => sync.start({ manual: true })}
                title="Sync your latest videos and views from YouTube"
                className="inline-flex items-center gap-1 hover:text-dark hover:underline dark:hover:text-white"
              >
                <RefreshCw className="size-3.5" aria-hidden />
                {sync.lastSyncedAt ? `Synced ${timeAgo(sync.lastSyncedAt)}` : "Sync now"}
              </button>
            )}
          </>
        }
        below={
          <>
            {sync.syncing && (
              <div className="mt-2 max-w-[260px]" role="status" aria-live="polite">
                <p className="mb-1 text-sm text-[var(--color-muted)]">Syncing your videos</p>
                <ProgressBar value={sync.progress} />
                <p className="mt-1 text-xs text-[var(--color-muted)]">{sync.detail ?? "Estimated progress"}</p>
              </div>
            )}
            {sync.state === "failed" && !sync.syncing && (
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => sync.start({ manual: true })}
                  className="rounded-lg border border-stroke bg-white px-3 py-1.5 text-xs font-medium text-dark transition hover:bg-gray-50 dark:border-white/15 dark:bg-transparent dark:text-white dark:hover:bg-white/10"
                >
                  Retry
                </button>
                <span className="text-xs text-[var(--color-muted)]">{sync.error ?? sync.detail ?? "The last sync failed."}</span>
              </div>
            )}
          </>
        }
        action={
          <Link href="/my-channel/trophy-case" className={cn(outlineButtonClass, "w-full sm:w-auto")}>
            <Trophy className="size-4" aria-hidden />
            Trophy Case
          </Link>
        }
      />

      {tabs.length > 1 && (
        <UnderlineTabs
          items={tabs.map((t) => ({ id: t, label: TAB_LABELS[t] }))}
          value={activeTab}
          onChange={(t) => setTab(t)}
        />
      )}

      <div className="border-b border-stroke dark:border-white/10">
        <div className="flex gap-6">
          {TIME_FILTERS.map((f) => {
            const days = f === "all" ? 0 : Number(f);
            const enabled = f === "all" || (!!channel.firstSnapshotDate && daysTracked >= days);
            const hint = enabled
              ? ""
              : !channel.firstSnapshotDate
                ? "Sync your channel to enable time filters"
                : `${days}-day view will be available in ${days - daysTracked} day${days - daysTracked === 1 ? "" : "s"}`;
            const active = timeFilter === f;
            return (
              <div key={f} className="group relative">
                <button
                  type="button"
                  disabled={!enabled}
                  onClick={() => enabled && changeTimeFilter(f)}
                  aria-pressed={active}
                  className={cn(
                    "relative pb-3 text-sm font-medium transition",
                    active
                      ? "text-dark dark:text-white"
                      : enabled
                        ? "text-dark-5 hover:text-dark dark:text-gray-400 dark:hover:text-white"
                        : "cursor-not-allowed text-dark-5 opacity-40 dark:text-gray-400",
                  )}
                >
                  {TIME_LABELS[f]}
                  {active && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-dark dark:bg-white" aria-hidden />}
                </button>
                {hint && (
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-dark px-3 py-2 text-xs text-white shadow-lg group-hover:block dark:bg-white dark:text-dark">
                    {hint}
                    <div className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-4 border-transparent border-t-dark dark:border-t-white" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {SORTS.filter((s) => timeFilter === "all" || (s !== "latest" && s !== "oldest")).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setBaseSort(s);
                setTiers(new Set());
              }}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-medium transition",
                sort === s
                  ? "bg-dark text-white dark:bg-white dark:text-dark"
                  : "border border-stroke bg-white text-dark hover:bg-gray-100 dark:border-white/15 dark:bg-transparent dark:text-white dark:hover:bg-white/10",
              )}
            >
              {SORT_LABELS[s]}
            </button>
          ))}
          {timeFilter === "all" && <OutlierTierFilter selected={tiers} onToggle={toggleTier} />}
        </div>
        <form
          className="flex"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
          }}
        >
          <div className="flex min-w-0 flex-1 items-center overflow-hidden rounded-lg border border-stroke bg-white focus-within:ring-2 focus-within:ring-primary dark:border-white/15 dark:bg-transparent sm:w-auto sm:min-w-[280px]">
            <div className="relative min-w-0 flex-1">
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search videos"
                aria-label="Search videos"
                className="w-full border-0 bg-transparent py-2 pl-3 pr-14 text-sm text-dark outline-none placeholder:text-dark-5 dark:text-white dark:placeholder:text-gray-500 [&::-webkit-search-cancel-button]:hidden"
              />
              <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                {searchInput.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchInput("");
                      setSearch("");
                    }}
                    aria-label="Clear search"
                    className="flex size-7 items-center justify-center rounded text-dark-5 hover:bg-gray-100 hover:text-dark dark:hover:bg-white/10 dark:hover:text-white"
                  >
                    ×
                  </button>
                )}
                <Search className="pointer-events-none size-4 text-dark-5" aria-hidden />
              </div>
            </div>
          </div>
        </form>
      </div>

      {showSkeleton ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="animate-pulse rounded-lg border border-stroke bg-gray-100 dark:border-white/10 dark:bg-white/5">
              <div className="aspect-video w-full rounded-t-lg bg-gray-200 dark:bg-white/10" />
              <div className="space-y-2 p-3">
                <div className="h-4 w-3/4 rounded bg-gray-200 dark:bg-white/10" />
                <div className="h-3 w-1/2 rounded bg-gray-200 dark:bg-white/10" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-stroke bg-gray-50 py-12 text-center text-[var(--color-muted)] dark:border-white/10 dark:bg-white/5">
          {error}
        </div>
      ) : videos.length === 0 ? (
        <div className="rounded-xl border border-stroke bg-gray-100 py-12 text-center dark:border-white/10 dark:bg-white/5">
          <p className="text-[var(--color-muted)]">{emptyMessage}</p>
          {sync.syncing && (
            <div className="mx-auto mt-4 max-w-[260px]">
              <ProgressBar value={sync.progress} />
              <p className="mt-1 text-xs text-[var(--color-muted)]">Estimated progress</p>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]", loading && "opacity-60")}>
            {videos.map((v) => (
              <VideoCard
                key={v.id}
                href={`/my-channel/${v.videoId}`}
                scoreContext="mine"
                showChannel={false}
                // As in the original, stats sit right under the title (not pinned to the card bottom)
                // and Shorts get a 9:16 thumbnail.
                className={cn("[&_.mt-auto]:mt-0", v.isShort && "[&_.aspect-video]:aspect-[9/16]")}
                video={{
                  videoId: v.videoId,
                  title: v.title,
                  thumbnail: v.thumbnail,
                  videoUrl: v.videoUrl,
                  views: v.periodViews ?? v.views,
                  publishAt: v.publishAt,
                  durationSeconds: v.durationSeconds,
                  outlierScore: v.comparison ? Number(v.comparison.multiplier) : null,
                }}
                hoverActions={
                  <ThumbAction label="View on YouTube" href={v.videoUrl}>
                    <ExternalLink className="size-4" />
                  </ThumbAction>
                }
                footer={
                  v.comparison ? (
                    <div className="mt-1 flex items-center gap-1.5">
                      <Tooltip content="Generate new titles for this video" side="bottom">
                        <button
                          type="button"
                          onClick={() => generateTitles(v)}
                          aria-label="Generate new titles for this video"
                          className="inline-flex items-center text-[var(--color-muted)] transition hover:text-accent-blue-text"
                        >
                          <SquarePen className="size-4" />
                        </button>
                      </Tooltip>
                      {v.hasChanges && (
                        <Tooltip content="View title/thumbnail change history" side="bottom">
                          <Link
                            href={`/my-channel/${v.videoId}`}
                            aria-label="View change history"
                            className="inline-flex items-center text-[var(--color-muted)] hover:text-accent-blue-text"
                          >
                            <Clock3 className="size-4" />
                          </Link>
                        </Tooltip>
                      )}
                    </div>
                  ) : null
                }
              />
            ))}
          </div>
          <div ref={sentinel} className="h-4" aria-hidden />
          {hasMore && loadingMore && (
            <div className="flex justify-center py-4">
              <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}
          {hasMore && !loadingMore && (
            <div className="flex justify-center py-4">
              <button
                type="button"
                onClick={loadMore}
                className="rounded-lg border border-stroke px-4 py-2 text-sm font-medium text-dark transition hover:bg-gray-50 dark:border-white/15 dark:text-white dark:hover:bg-white/10"
              >
                Load more videos
              </button>
            </div>
          )}
          {!hasMore && <p className="py-3 text-center text-sm text-[var(--color-muted)]">You&apos;re all caught up.</p>}
        </>
      )}
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-white/10">
      <div className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out dark:bg-sky-300" style={{ width: `${value}%` }} />
    </div>
  );
}

function UnderlineTabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="border-b border-stroke dark:border-white/10" role="tablist">
      <div className="flex gap-6">
        {items.map((t) => {
          const active = t.id === value;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(t.id)}
              className={cn(
                "relative pb-3 text-sm font-medium transition",
                active ? "text-dark dark:text-white" : "text-dark-5 hover:text-dark dark:text-gray-400 dark:hover:text-white",
              )}
            >
              {t.label}
              {active && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-dark dark:bg-white" aria-hidden />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
