"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Shuffle } from "lucide-react";
import { cn, formatDuration, parseIsoDuration, timeAgo } from "@/lib/format";
import { useIsDark } from "@/components/channel/useIsDark";
import { EmptyCombos, Segmented, ViewIntro, type ComboWithStyle } from "./StudioViews";
import { ThumbnailPlaceholder, ThumbnailText } from "./ThumbnailText";

type FeedVideo = {
  id: string;
  videoId: string;
  title: string;
  thumbnail: string;
  views: number;
  publishAt: string | null;
  duration: string | null;
  Channel: { channelName: string; channelAvatar: string | null };
};
type Meta = { appliedMode: "niche" | "random"; supportsNiche: boolean; fallbackReason: string | null };
type Item = { type: "video"; data: FeedVideo } | { type: "combo"; data: ComboWithStyle };

const compact = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact" }).format(n);

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Small deterministic PRNG (mulberry32) so the feed order is stable between renders. */
function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Feed size: at least a full screen of cards, 3 (desktop) or 2 (mobile) per combo. */
const feedSize = (combos: number, device: "mobile" | "desktop") => Math.max(device === "mobile" ? 6 : 12, combos * (device === "mobile" ? 2 : 3));

function FeedCard({
  thumbnail,
  title,
  channelName,
  channelAvatar,
  stats,
  duration,
  combo,
  dark,
}: {
  thumbnail: string | null;
  title: string;
  channelName: string;
  channelAvatar: string | null;
  stats: string;
  duration: string | null;
  combo?: ComboWithStyle;
  dark: boolean;
}) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  return (
    <article className="flex flex-col">
      <div className={cn("@container relative aspect-video w-full overflow-hidden rounded-lg", dark ? "bg-[#272727]" : "bg-[#e8e8e8]")}>
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <ThumbnailPlaceholder dark={dark} />
        )}
        {combo && <ThumbnailText text={combo.thumbnailText} style={combo.style} />}
        {duration && (
          <span className="font-roboto absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium text-white" aria-hidden>
            {duration}
          </span>
        )}
      </div>
      <div className="mt-3 flex gap-3">
        <div className="shrink-0">
          {channelAvatar && !avatarFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={channelAvatar} alt="" width={36} height={36} onError={() => setAvatarFailed(true)} className="size-9 rounded-full object-cover" />
          ) : (
            <div
              className={cn(
                "flex size-9 items-center justify-center rounded-full text-xs font-semibold",
                dark ? "bg-[#272727] text-gray-300" : "bg-[#e8e8e8] text-dark-5",
              )}
              aria-hidden
            >
              {channelName.charAt(0).toUpperCase() || "?"}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 title={title || "Untitled"} className={cn("font-roboto line-clamp-2 text-sm font-medium leading-tight", dark ? "text-[#f1f1f1]" : "text-[#0f0f0f]")}>
            {title || "Untitled"}
          </h3>
          <p className={cn("font-roboto mt-1 text-xs", dark ? "text-[#aaaaaa]" : "text-[#606060]")}>{channelName}</p>
          <p className={cn("font-roboto text-xs", dark ? "text-[#aaaaaa]" : "text-[#606060]")}>{stats}</p>
        </div>
      </div>
    </article>
  );
}

/** Your combos dropped into a YouTube home feed of real videos from your niche. */
export function YouTubePreview({
  combos,
  channelName,
  channelAvatarUrl,
  onGoToWorkspace,
}: {
  combos: ComboWithStyle[];
  channelName: string;
  channelAvatarUrl: string | null;
  onGoToWorkspace: () => void;
}) {
  const appDark = useIsDark();
  const [mode, setMode] = useState<"niche" | "random">("niche");
  const [device, setDevice] = useState<"mobile" | "desktop">("desktop");
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  const [videos, setVideos] = useState<FeedVideo[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scrolling, setScrolling] = useState(false);
  const [speed, setSpeed] = useState(200);
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const dark = (theme ?? (appDark ? "dark" : "light")) === "dark";
  const comboCount = combos.length;
  const needed = feedSize(comboCount, device) - comboCount;

  useEffect(() => {
    if (!comboCount) return;
    let cancelled = false;
    const kick = setTimeout(() => {
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }
    }, 0);
    fetch(`/api/studio/preview-videos?${new URLSearchParams({ limit: String(Math.max(needed, 1)), mode })}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Failed to load videos");
        if (cancelled) return;
        setVideos(body.videos ?? []);
        setMeta(body.meta ?? null);
      })
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load videos"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      clearTimeout(kick);
    };
  }, [comboCount, needed, mode, reloadKey]);

  // Combos land at pseudo-random slots among the real videos; Shuffle re-deals them.
  const items = useMemo<Item[]>(() => {
    if (!combos.length || !videos.length) return [];
    const feed: Item[] = videos.slice(0, needed).map((v) => ({ type: "video", data: v }));
    const rand = seededRandom(shuffleSeed + hashString(videos.map((v) => v.id).join("|")));
    const slots = Array.from({ length: feed.length + 1 }, (_, i) => i);
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    slots
      .slice(0, combos.length)
      .sort((a, b) => b - a)
      .forEach((slot, i) => feed.splice(slot, 0, { type: "combo", data: combos[i] }));
    return feed;
  }, [combos, videos, needed, shuffleSeed]);

  // Endless auto-scroll: the feed repeats 6x and wraps after one copy.
  useEffect(() => {
    if (!scrolling) return;
    let last: number | null = null;
    let raf = 0;
    const tick = (t: number) => {
      const el = scroller.current;
      const inner = content.current;
      if (!el || !inner) return;
      if (last === null) last = t;
      el.scrollTop += (speed * (t - last)) / 1000;
      last = t;
      const copy = inner.scrollHeight / 6;
      if (el.scrollTop >= copy) el.scrollTop -= copy;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scrolling, speed]);

  if (!comboCount) return <EmptyCombos message="Add titles and thumbnails in the Workspace to get started." onGoToWorkspace={onGoToWorkspace} />;

  const render = (item: Item, key: string) =>
    item.type === "video" ? (
      <FeedCard
        key={key}
        dark={dark}
        thumbnail={item.data.thumbnail}
        title={item.data.title}
        channelName={item.data.Channel.channelName}
        channelAvatar={item.data.Channel.channelAvatar}
        stats={`${compact(item.data.views)} views • ${item.data.publishAt ? timeAgo(item.data.publishAt) : "—"}`}
        duration={formatDuration(parseIsoDuration(item.data.duration)) || null}
      />
    ) : (
      <FeedCard
        key={key}
        dark={dark}
        combo={item.data}
        thumbnail={item.data.imageUrl || null}
        title={item.data.title}
        channelName={channelName}
        channelAvatar={channelAvatarUrl}
        stats="100K views • 1 day ago"
        duration="12:34"
      />
    );

  const grid = device === "mobile" ? "mx-auto max-w-[400px] grid-cols-1" : "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4";

  return (
    <div className="space-y-6">
      <ViewIntro
        title="YouTube Preview"
        aside={
          <>
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { id: "niche", label: "Your niche" },
                { id: "random", label: "Random" },
              ]}
            />
            <Segmented
              className="hidden sm:inline-flex"
              value={device}
              onChange={setDevice}
              options={[
                { id: "mobile", label: "Mobile" },
                { id: "desktop", label: "Desktop" },
              ]}
            />
            <Segmented
              value={dark ? "dark" : "light"}
              onChange={setTheme}
              options={[
                { id: "light", label: "Light" },
                { id: "dark", label: "Dark" },
              ]}
            />
            <div className="inline-flex rounded-lg border border-stroke p-1 dark:border-white/15">
              <button
                type="button"
                onClick={() => setShuffleSeed(Math.floor(Math.random() * 1_000_000))}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-[var(--color-muted)] transition-colors hover:text-dark dark:hover:text-white"
              >
                <Shuffle className="size-3.5" aria-hidden />
                Shuffle
              </button>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-lg border border-stroke p-1 dark:border-white/15">
                <button
                  type="button"
                  onClick={() => setScrolling((s) => !s)}
                  aria-pressed={scrolling}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    scrolling ? "bg-primary/10 text-primary dark:bg-sky-300/20 dark:text-white" : "text-[var(--color-muted)] hover:text-dark dark:hover:text-white",
                  )}
                >
                  {scrolling ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
                  {scrolling ? "Pause" : "Scroll"}
                </button>
              </div>
              <input
                type="range"
                min={25}
                max={400}
                step={25}
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                aria-label="Scroll speed"
                className="h-2 w-24 cursor-pointer accent-primary"
              />
              <span className="min-w-[50px] text-sm text-[var(--color-muted)]">{speed}px/s</span>
            </div>
          </>
        }
      >
        <p>See how your title and thumbnail combos would look on the YouTube homepage.</p>
        {meta?.fallbackReason && <p className="mt-2 text-xs">{meta.fallbackReason}</p>}
      </ViewIntro>
      {meta && !meta.supportsNiche && (
        <p className="text-xs text-[var(--color-muted)]">We&apos;ll switch to niche-matched videos automatically once this channel has niche tags.</p>
      )}

      {loading && !videos.length ? (
        <div className="flex min-h-[400px] items-center justify-center">
          <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : error ? (
        <div className="flex min-h-[400px] flex-col items-center justify-center rounded-xl border border-stroke bg-white p-8 dark:border-white/10 dark:bg-[#18191c]">
          <h3 className="mb-2 text-lg font-semibold text-dark dark:text-white">Error loading videos</h3>
          <p className="mb-4 text-center text-sm text-[var(--color-muted)]">{error}</p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="rounded-lg border border-stroke px-4 py-2 text-sm font-medium dark:border-white/15 dark:text-white"
          >
            Try Again
          </button>
        </div>
      ) : !videos.length ? (
        <div className="flex min-h-[400px] flex-col items-center justify-center rounded-xl border border-dashed border-stroke bg-white p-8 dark:border-white/15 dark:bg-[#18191c]">
          <h3 className="mb-2 text-lg font-semibold text-dark dark:text-white">No videos available</h3>
          <p className="mb-4 text-center text-sm text-[var(--color-muted)]">
            {meta?.appliedMode === "niche"
              ? "We couldn't find enough videos tagged to your niche yet. Try Random for a broader preview."
              : "We couldn't find enough eligible videos for the random preview right now."}
          </p>
          {meta?.appliedMode === "niche" && (
            <button type="button" onClick={() => setMode("random")} className="rounded-lg border border-stroke px-4 py-2 text-sm font-medium">
              Show Random Videos
            </button>
          )}
        </div>
      ) : (
        <div
          ref={scroller}
          className={cn("rounded-xl", dark ? "bg-[#0f0f0f]" : "bg-white", scrolling && "relative h-[700px] overflow-y-auto border border-stroke dark:border-white/10")}
          style={scrolling ? { scrollBehavior: "auto" } : undefined}
        >
          <div ref={content} className={cn("grid gap-x-4 gap-y-8", dark && "p-4", scrolling && "p-6", grid)}>
            {(scrolling ? Array.from({ length: 6 }, () => items).flat() : items).map((item, i) => render(item, `${item.type}-${i}`))}
          </div>
        </div>
      )}
    </div>
  );
}
