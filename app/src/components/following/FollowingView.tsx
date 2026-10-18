"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { PageFrame } from "@/components/shell/AppShell";
import { toast } from "@/components/ui/Toaster";
import { getJson, sendJson } from "@/lib/api-client";
import { cn } from "@/lib/format";
import {
  FOLLOWING_VIEWS_FLOOR,
  FOLLOWING_VIEWS_STEPS,
  VIEWS_CEILING,
  compatibleWindows,
  createChannelSlug,
  parseChannelId,
  parseChannelName,
  tierRange,
  viewsLabel,
} from "@/lib/research/filters";
import type { FollowingListSummary, ResearchVideo } from "@/lib/research/types";
import { ActionToaster } from "@/components/outliers/ActionToast";
import {
  EmptyState,
  FILTER_ACTIVE_TINT,
  GRID,
  GridSkeleton,
  InfiniteSentinel,
  MUTED,
  Spinner,
  VideoTypeTabs,
  filterButtonClass,
  useDismiss,
} from "@/components/outliers/controls";
import { DateDropdown, TierDropdown } from "@/components/outliers/FilterDropdowns";
import { RangeSlider } from "@/components/outliers/RangeSlider";
import { ResearchVideoCard, VideoActionsMenu } from "@/components/outliers/ResearchVideoCard";
import { SearchBox } from "@/components/outliers/SearchBox";
import { useVideoActions } from "@/components/outliers/useVideoActions";
import { ChannelSearchInput, type ChannelPick } from "./ChannelSearchInput";
import { FollowChannelModal, NewListModal } from "./FollowModals";
import { ManageChannelsModal, type ManageScope } from "./ManageChannelsModal";
import { useFollowState } from "./useFollowState";

type Scope = { mode: "all" | "unlisted" | "list"; listIds: string[] };
type Result = { key: string; videos: ResearchVideo[]; hasMore: boolean; page: number; totalChannels: number };
type ApiResult = { videos: ResearchVideo[]; hasMore: boolean; totalChannels: number; error?: string };
type SyncStatus = { syncing: boolean; failedCount: number; total: number; lastSyncedAt: string | null };
type ListsResponse = { lists: { id: string; name: string; channelIds: string[] }[]; followedChannelIds: string[] };

/** Empty account: search box to follow the first channels (original "Start tracking channels"). */
function StartTracking({ onAdded }: { onAdded: () => void }) {
  const [busy, setBusy] = useState(false);
  const add = async (c: ChannelPick) => {
    setBusy(true);
    try {
      const { list } = await sendJson<{ list: { id: string } }>("/api/following/lists", "POST", { name: "My Channels" }).catch(async () => {
        const all = await getJson<ListsResponse>("/api/following/lists");
        const existing = all.lists.find((l) => l.name === "My Channels");
        if (!existing) throw new Error("Failed to create list");
        return { list: existing };
      });
      await sendJson(`/api/following/lists/${list.id}/channels`, "POST", { channelId: c.channelId, channelName: c.channelName, channelAvatar: c.channelAvatar, subscriberCount: c.subscriberCount });
      toast.success(`Added ${c.channelName} to My Channels`);
      onAdded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add channel");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-2xl space-y-6 py-12">
      <div className="text-center">
        <h2 className="mb-2 text-2xl font-bold text-dark dark:text-white">Start tracking channels</h2>
        <p className={MUTED}>Search for competitor or similar channels to track their latest videos</p>
      </div>
      <ChannelSearchInput onSelect={(c) => void add(c)} />
      {busy && (
        <p className={cn("flex items-center justify-center gap-2 text-sm", MUTED)}>
          <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" /> Adding channel...
        </p>
      )}
    </div>
  );
}

function ScopeDropdown({ scope, lists, onChange }: { scope: Scope; lists: FollowingListSummary[]; onChange: (s: Scope) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const label =
    scope.mode === "unlisted"
      ? "Not in any list"
      : scope.mode === "list" && scope.listIds.length
        ? scope.listIds.length === 1
          ? lists.find((l) => l.id === scope.listIds[0])?.name ?? "1 list"
          : `${scope.listIds.length} lists`
        : "All channels";
  const row = (key: string, text: string, on: boolean, onClick: () => void, count?: number) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className="flex w-full min-w-0 items-center gap-3 border-b border-stroke px-4 py-3 text-left text-sm transition last:border-b-0 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5"
    >
      <span className={cn("flex size-5 flex-shrink-0 items-center justify-center rounded border", on ? "border-primary bg-primary text-white" : "border-stroke dark:border-white/20")}>
        {on && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1 truncate text-dark dark:text-white">{text}</span>
      {count != null && <span className={cn("flex-shrink-0 text-xs", MUTED)}>{count}</span>}
    </button>
  );
  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-stroke bg-white px-4 py-2 text-sm font-medium text-dark transition hover:bg-gray-100 dark:border-white/10 dark:bg-[#18191c] dark:text-white dark:hover:bg-white/5"
      >
        {label}
        <ChevronDown className={cn("size-4 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 max-h-[70vh] w-72 overflow-y-auto rounded-lg border border-stroke bg-white shadow-lg dark:border-white/10 dark:bg-[#1b1c1f]">
          {row("all", "All channels", scope.mode === "all", () => {
            onChange({ mode: "all", listIds: [] });
            setOpen(false);
          })}
          {row("unlisted", "Not in any list", scope.mode === "unlisted", () => {
            onChange({ mode: "unlisted", listIds: [] });
            setOpen(false);
          })}
          {lists.map((l) =>
            row(
              l.id,
              l.name,
              scope.mode === "list" && scope.listIds.includes(l.id),
              () => {
                const current = scope.mode === "list" ? scope.listIds : [];
                const next = current.includes(l.id) ? current.filter((id) => id !== l.id) : [...current, l.id];
                if (next.length) onChange({ mode: "list", listIds: next });
                else {
                  onChange({ mode: "all", listIds: [] });
                  setOpen(false);
                }
              },
              l.channelIds.length,
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function FollowingView({
  initialLists,
  initialFollowedChannelIds,
  initialSyncedAt,
}: {
  initialLists: FollowingListSummary[];
  initialFollowedChannelIds: string[];
  /** Latest RSS sync time when the page rendered; a newer one means the feed has new rows. */
  initialSyncedAt: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const channelParam = params.get("channel");
  const channelId = parseChannelId(channelParam);

  const [scope, setScope] = useState<Scope>({ mode: "all", listIds: [] });
  const [type, setType] = useState<"longform" | "shorts">("longform");
  const [tiers, setTiers] = useState<Set<string>>(new Set());
  const [publishDate, setPublishDate] = useState("all");
  const [excludedDate, setExcludedDate] = useState("all");
  const [views, setViews] = useState({ min: FOLLOWING_VIEWS_FLOOR, max: VIEWS_CEILING });
  const [viewsOpen, setViewsOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [modal, setModal] = useState<"follow" | "list" | "manage" | null>(null);

  useEffect(() => {
    const value = searchInput.trim();
    if (!value || value === search) return;
    const t = setTimeout(() => setSearch(value), 400);
    return () => clearTimeout(t);
  }, [searchInput, search]);

  const [result, setResult] = useState<Result | null>(null);
  const patchVideo = (videoId: string, p: Partial<ResearchVideo>) =>
    setResult((r) => (r ? { ...r, videos: r.videos.map((v) => (v.videoId === videoId ? { ...v, ...p } : v)) } : r));
  const actions = useVideoActions({ onPatch: patchVideo });
  const follow = useFollowState({
    initialFollowed: initialFollowedChannelIds,
    initialLists,
    onChange: (id, on) => {
      if (on) return;
      setResult((r) => (r ? { ...r, videos: r.videos.filter((v) => v.channelId !== id) } : r));
      if (id === channelId) router.push(pathname, { scroll: false });
    },
  });
  const { lists, setLists, setFollowed } = follow;

  const refreshLists = useCallback(async () => {
    try {
      const res = await getJson<ListsResponse>("/api/following/lists");
      setLists(res.lists.map((l) => ({ id: l.id, name: l.name, channelIds: l.channelIds })));
      setFollowed(new Set(res.followedChannelIds));
    } catch {
      // keep the current view
    }
  }, [setLists, setFollowed]);

  // Background RSS sync: refresh stale channels on arrival and poll while it runs. Whenever the
  // latest sync time moves past what the feed was loaded with, reload the feed.
  const [sync, setSync] = useState<SyncStatus>({ syncing: false, failedCount: 0, total: 0, lastSyncedAt: initialSyncedAt });
  const [pollToken, setPollToken] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const followedCount = follow.followed.size;
  const startedSync = useRef(false);
  const feedStamp = useRef(initialSyncedAt);
  useEffect(() => {
    if (!followedCount) return;
    let alive = true;
    let idlePolls = 0;
    const poll = async () => {
      try {
        const s = await getJson<SyncStatus>("/api/following/sync-status");
        if (!alive) return;
        setSync(s);
        if (s.lastSyncedAt !== feedStamp.current) {
          feedStamp.current = s.lastSyncedAt;
          setRefreshKey((k) => k + 1);
        }
        idlePolls = s.syncing ? 0 : idlePolls + 1;
        if (idlePolls >= 2) clearInterval(timer);
      } catch {
        // offline: try again on the next tick
      }
    };
    const timer = setInterval(() => void poll(), 4000);
    const kickoff = startedSync.current ? Promise.resolve() : sendJson("/api/following/sync", "POST", { onlyStale: true });
    startedSync.current = true;
    kickoff.catch(() => undefined).finally(() => void poll());
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [followedCount, pollToken]);

  const retrySync = async () => {
    setRetrying(true);
    try {
      await sendJson("/api/following/sync", "POST", { onlyFailed: true });
      toast.success("Retry queued. Syncing your following channels now.");
      setPollToken((t) => t + 1);
    } catch {
      toast.error("Failed to retry sync");
    } finally {
      setRetrying(false);
    }
  };

  const queryKey = useMemo(() => {
    const p = new URLSearchParams();
    if (scope.mode === "list" && scope.listIds.length) p.set("listIds", scope.listIds.join(","));
    else if (scope.mode === "unlisted") p.set("unlistedOnly", "true");
    p.set("type", type);
    p.set("page", "0");
    if (search) {
      p.set("search", search);
      p.set("searchMode", "exact");
    }
    if (channelParam) p.set("channel", channelParam);
    const { min, max } = tierRange(tiers);
    p.set("outlierMin", String(min));
    p.set("outlierMax", String(max));
    p.set("viewsMin", String(views.min));
    p.set("viewsMax", String(views.max));
    p.set("publishDate", publishDate);
    if (excludedDate !== "all") p.set("excludePublishDate", excludedDate);
    return p.toString();
  }, [scope, type, search, channelParam, tiers, views, publishDate, excludedDate]);

  const loading = result?.key !== queryKey;
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/following/videos?${queryKey}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as ApiResult;
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error ?? "Failed to load videos");
        setResult({ key: queryKey, videos: body.videos ?? [], hasMore: !!body.hasMore, page: 0, totalChannels: body.totalChannels ?? 0 });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : "Failed to load videos");
        setResult({ key: queryKey, videos: [], hasMore: false, page: 0, totalChannels: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [queryKey, refreshKey]);

  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const loadMore = async () => {
    if (!result || loading || !result.hasMore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const q = new URLSearchParams(queryKey);
    q.set("page", String(result.page + 1));
    try {
      const body = await getJson<ApiResult>(`/api/following/videos?${q.toString()}`);
      setResult((r) => {
        if (!r || r.key !== queryKey) return r;
        const seen = new Set(r.videos.map((v) => v.videoId));
        return { ...r, videos: [...r.videos, ...body.videos.filter((v) => !seen.has(v.videoId))], hasMore: body.hasMore, page: r.page + 1 };
      });
    } catch {
      toast.error("Failed to load more videos");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  };

  const viewsChanged = views.min !== FOLLOWING_VIEWS_FLOOR || views.max !== VIEWS_CEILING;
  const anyFilter = tiers.size > 0 || publishDate !== "all" || excludedDate !== "all" || viewsChanged || !!search;
  const clearAll = () => {
    setTiers(new Set());
    setPublishDate("all");
    setExcludedDate("all");
    setViews({ min: FOLLOWING_VIEWS_FLOOR, max: VIEWS_CEILING });
    setViewsOpen(false);
    setSearchInput("");
    setSearch("");
  };

  const filterToChannel = (id: string, name: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("channel", createChannelSlug(id, name));
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const clearChannel = () => {
    const next = new URLSearchParams(params.toString());
    next.delete("channel");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const onFollowingChanged = () => {
    void refreshLists();
    setRefreshKey((k) => k + 1);
    setPollToken((t) => t + 1);
  };

  const videos = result?.videos ?? [];
  const totalChannels = result?.totalChannels ?? 0;
  const channelName = channelId ? videos.find((v) => v.channelId === channelId)?.channelName || parseChannelName(channelParam) || channelId : null;
  const selectedList = scope.mode === "list" && scope.listIds.length === 1 ? scope.listIds[0] : null;
  const manageScope: ManageScope = { mode: scope.mode === "list" ? "list" : scope.mode, listId: selectedList ?? scope.listIds[0] ?? null };
  const showStart = followedCount === 0 && lists.length === 0;

  const emptyMessage = channelId
    ? `No videos found from ${channelName || "this channel"}.`
    : scope.mode === "unlisted" && totalChannels === 0
      ? "All your followed channels are in a list."
      : scope.mode === "list" && totalChannels === 0
        ? "This list has no channels yet."
        : anyFilter || totalChannels === 0
          ? "No videos found. Try adjusting your filters."
          : sync.syncing
            ? "Syncing your following channels' videos..."
            : "No videos synced yet. Sync now to pull videos from YouTube.";

  const headerButton = "flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition";
  return (
    <PageFrame
      title="Following"
      actions={
        <>
          <button type="button" onClick={() => setModal("follow")} className={cn(headerButton, "bg-primary text-white hover:bg-primary/90")}>
            <Plus className="hidden size-4 sm:block" />
            Follow channel
          </button>
          <button
            type="button"
            onClick={() => setModal("list")}
            className={cn(headerButton, "border border-stroke bg-white text-dark hover:bg-gray-100 dark:border-white/10 dark:bg-transparent dark:text-white dark:hover:bg-white/5")}
          >
            <Plus className="hidden size-4 sm:block" />
            New list
          </button>
          {followedCount > 0 && (
            <button
              type="button"
              onClick={() => setModal("manage")}
              className={cn(headerButton, "border border-stroke bg-white text-dark hover:bg-gray-100 dark:border-white/10 dark:bg-transparent dark:text-white dark:hover:bg-white/5")}
            >
              Manage channels
            </button>
          )}
        </>
      }
    >
      {showStart ? (
        <StartTracking onAdded={onFollowingChanged} />
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-2">{lists.length > 0 && <ScopeDropdown scope={scope} lists={lists} onChange={setScope} />}</div>
          <div className="space-y-4">
            <VideoTypeTabs
              value={type}
              onChange={setType}
              tabs={[
                { id: "longform", label: "Videos" },
                { id: "shorts", label: "Shorts" },
              ]}
            />
            <div className="sticky top-3 z-20 space-y-4 border-b border-stroke bg-white/95 pb-3 backdrop-blur before:pointer-events-none before:absolute before:-top-3 before:left-0 before:right-0 before:h-3 before:bg-white/95 before:backdrop-blur dark:border-white/10 dark:bg-[#111214]/95 dark:before:bg-[#111214]/95">
              {channelId && (
                <div className="flex items-center gap-2">
                  <span className={cn("text-sm", MUTED)}>Filtered to:</span>
                  <button
                    type="button"
                    onClick={clearChannel}
                    className="flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition hover:bg-primary/20 dark:bg-primary/25 dark:text-white"
                  >
                    {channelName}
                    <X className="size-4" />
                  </button>
                </div>
              )}
              {(sync.syncing || sync.failedCount > 0) && (
                <div className="flex flex-wrap items-center gap-2">
                  {sync.syncing && (
                    <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary dark:bg-primary/25 dark:text-white">
                      <span className="inline-block size-2 animate-pulse rounded-full bg-current" />
                      Syncing
                    </span>
                  )}
                  {sync.failedCount > 0 && (
                    <>
                      <span className="rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-600 dark:text-red-400">
                        {sync.failedCount} channel{sync.failedCount === 1 ? "" : "s"} failed
                      </span>
                      <button
                        type="button"
                        onClick={() => void retrySync()}
                        disabled={retrying}
                        className="rounded-lg border border-stroke bg-white px-3 py-1.5 text-xs font-medium text-dark transition hover:bg-gray-50 disabled:opacity-60 dark:border-white/10 dark:bg-transparent dark:text-white"
                      >
                        {retrying ? "Retrying..." : "Retry"}
                      </button>
                    </>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <TierDropdown
                  label="Outlier"
                  selected={tiers}
                  activeWhenAll
                  activeClass={FILTER_ACTIVE_TINT}
                  onToggle={(id) =>
                    setTiers((s) => {
                      const next = new Set(s);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                />
                <DateDropdown
                  include={publishDate}
                  exclude={excludedDate}
                  activeClass={FILTER_ACTIVE_TINT}
                  onInclude={(id) => {
                    setPublishDate(id);
                    if (!compatibleWindows(id, excludedDate)) setExcludedDate("all");
                  }}
                  onExclude={(id) => {
                    setExcludedDate(id);
                    if (!compatibleWindows(publishDate, id)) setPublishDate("all");
                  }}
                />
                <button type="button" onClick={() => setViewsOpen((o) => !o)} aria-expanded={viewsOpen} className={filterButtonClass(viewsOpen || viewsChanged, FILTER_ACTIVE_TINT)}>
                  Views
                  <ChevronDown className={cn("size-4 transition", viewsOpen && "rotate-180")} />
                </button>
                <SearchBox
                  className="w-52"
                  value={searchInput}
                  onChange={(v) => {
                    setSearchInput(v);
                    if (!v.trim()) setSearch("");
                  }}
                  onSubmit={() => setSearch(searchInput.trim())}
                  onClear={() => {
                    setSearchInput("");
                    setSearch("");
                  }}
                  placeholder="Search titles"
                  ariaLabel="Search videos"
                />
                {anyFilter && (
                  <button
                    type="button"
                    onClick={clearAll}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium text-dark-5 transition hover:bg-gray-100 hover:text-dark dark:hover:bg-white/10 dark:hover:text-white"
                  >
                    <X className="size-3.5" />
                    Clear
                  </button>
                )}
              </div>
              {viewsOpen && (
                <div className="max-w-[420px]">
                  <p className={cn("mb-1.5 text-xs font-medium", MUTED)}>
                    Views: {viewsLabel(views.min)} – {viewsLabel(views.max)}
                  </p>
                  <RangeSlider label="Views" steps={FOLLOWING_VIEWS_STEPS} min={views.min} max={views.max} format={viewsLabel} onChange={(min, max) => setViews({ min, max })} />
                </div>
              )}
            </div>

            {loading ? (
              <GridSkeleton />
            ) : videos.length === 0 ? (
              <EmptyState
                message={emptyMessage}
                action={
                  channelId ? (
                    <button type="button" onClick={clearChannel} className="text-sm text-primary hover:underline dark:text-sky-300">
                      Clear filter
                    </button>
                  ) : totalChannels > 0 && sync.failedCount > 0 ? (
                    <button type="button" onClick={() => void retrySync()} disabled={retrying} className="text-sm text-primary hover:underline disabled:opacity-60 dark:text-sky-300">
                      {retrying ? "Retrying..." : "Retry sync"}
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <div className={GRID}>
                  {videos.map((v) => (
                    <ResearchVideoCard
                      key={v.videoId}
                      video={v}
                      followed={!!v.channelId && follow.followed.has(v.channelId)}
                      followPending={follow.isPending(v.channelId)}
                      onToggleFollow={() => void follow.toggleFollow(v)}
                      onChannelClick={filterToChannel}
                      menu={<VideoActionsMenu video={v} actions={actions} variant="following" />}
                    />
                  ))}
                </div>
                <InfiniteSentinel onReach={() => void loadMore()} disabled={!result?.hasMore} />
                {result?.hasMore && loadingMore && (
                  <div className="flex justify-center py-4">
                    <Spinner />
                  </div>
                )}
                {!result?.hasMore && videos.length > 0 && <p className={cn("py-3 text-center text-sm", MUTED)}>You&apos;re all caught up.</p>}
              </>
            )}
          </div>
        </>
      )}

      <FollowChannelModal open={modal === "follow"} onClose={() => setModal(null)} lists={lists} onFollowed={onFollowingChanged} />
      <NewListModal open={modal === "list"} onClose={() => setModal(null)} onCreated={onFollowingChanged} />
      <ManageChannelsModal open={modal === "manage"} scope={manageScope} onClose={() => setModal(null)} onUpdated={onFollowingChanged} />
      {actions.modals}
      {follow.modals}
      <ActionToaster />
    </PageFrame>
  );
}
