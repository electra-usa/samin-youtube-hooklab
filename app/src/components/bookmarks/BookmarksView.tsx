"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bookmark as BookmarkIcon, Check, ChevronDown, Plus, Settings2 } from "lucide-react";
import { PageFrame } from "@/components/shell/AppShell";
import { toast } from "@/components/ui/Toaster";
import { getJson } from "@/lib/api-client";
import { BOOKMARKS_UPDATED, emit } from "@/lib/client-events";
import { cn } from "@/lib/format";
import type { FollowingListSummary, ResearchVideo } from "@/lib/research/types";
import { ActionToaster } from "@/components/outliers/ActionToast";
import { EmptyState, GRID, GridSkeleton, MUTED, VideoTypeTabs, useDismiss } from "@/components/outliers/controls";
import { ResearchVideoCard, VideoActionsMenu } from "@/components/outliers/ResearchVideoCard";
import { SearchBox } from "@/components/outliers/SearchBox";
import { useVideoActions } from "@/components/outliers/useVideoActions";
import { useFollowState } from "@/components/following/useFollowState";
import { ManageTagModal, NewTagModal } from "./TagAdminModals";

type BookmarkItem = {
  id: string;
  videoId: string;
  isShort: boolean;
  createdAt: string;
  tags: string[];
  projectIds: string[];
  video: Partial<ResearchVideo> & { videoId: string; title: string };
};
type TagSummary = { id: string; name: string; count: number };
type Recommendation = ResearchVideo & { recommendationBucket?: string; matchedNiche?: string | null };

const ALL = "__ALL__";
const UNTAGGED = "__UNTAGGED__";
const RECENT_KEY = "hooklab.bookmark-recommendations.recent";
const RECENT_TTL = 21 * 86_400_000;

// Recently suggested videos, so each visit and "Get new suggestions" shows fresh ones.
function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as { videoId: string; seenAt: number }[];
    return raw.filter((e) => Date.now() - e.seenAt < RECENT_TTL).map((e) => e.videoId);
  } catch {
    return [];
  }
}
function rememberRecent(ids: string[]) {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as { videoId: string; seenAt: number }[];
    const now = Date.now();
    const merged = [...ids.map((videoId) => ({ videoId, seenAt: now })), ...raw.filter((e) => !ids.includes(e.videoId) && now - e.seenAt < RECENT_TTL)];
    localStorage.setItem(RECENT_KEY, JSON.stringify(merged.slice(0, 60)));
  } catch {
    // storage unavailable: suggestions just won't rotate across visits
  }
}

function toVideo(b: BookmarkItem): ResearchVideo {
  const v = b.video;
  return {
    id: v.id ?? b.videoId,
    videoId: b.videoId,
    title: v.title,
    titleLength: v.titleLength ?? v.title.length,
    videoUrl: v.videoUrl ?? `https://www.youtube.com/watch?v=${b.videoId}`,
    thumbnail: v.thumbnail ?? `https://i.ytimg.com/vi/${b.videoId}/hqdefault.jpg`,
    channelId: v.channelId ?? null,
    channelName: v.channelName ?? null,
    subscriberCount: v.subscriberCount ?? null,
    views: v.views ?? null,
    outlierScore: v.outlierScore ?? null,
    publishAt: v.publishAt ?? null,
    duration: v.duration ?? null,
    durationSeconds: v.durationSeconds ?? null,
    isShort: b.isShort,
    frame: v.frame ?? null,
    secondaryFrame: v.secondaryFrame ?? null,
    pov: v.pov ?? null,
    featuredInNewsletter: !!v.featuredInNewsletter,
    niches: v.niches ?? [],
    clickTriggers: v.clickTriggers ?? [],
    videoTypes: v.videoTypes ?? [],
    isBookmarked: true,
    bookmarkTags: b.tags,
    projectIds: b.projectIds,
  };
}

function TagFilter({
  selected,
  tags,
  bookmarks,
  onToggle,
  onAll,
  onManage,
}: {
  selected: Set<string>;
  tags: TagSummary[];
  bookmarks: BookmarkItem[];
  onToggle: (id: string) => void;
  onAll: () => void;
  onManage: (tag: TagSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const all = selected.has(ALL);
  const picked = [...selected].filter((s) => s !== ALL);
  const label = all ? "All bookmarks" : picked.length === 1 ? (picked[0] === UNTAGGED ? "Untagged" : picked[0]) : `${picked.length} tags`;
  const box = (on: boolean) => (
    <span className={cn("flex size-5 flex-shrink-0 items-center justify-center rounded border", on ? "border-primary bg-primary text-white" : "border-gray-500 bg-white dark:bg-transparent")}>
      {on && <Check className="size-3" strokeWidth={3} />}
    </span>
  );
  const items = [{ id: UNTAGGED, label: "Untagged", count: bookmarks.filter((b) => b.tags.length === 0).length, tag: null as TagSummary | null }, ...tags.map((t) => ({ id: t.name, label: t.name, count: t.count, tag: t }))];
  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition",
          !all ? "border-primary bg-primary/10 text-primary dark:bg-primary/25 dark:text-white" : "border-stroke bg-white text-dark hover:bg-gray-50 dark:border-white/10 dark:bg-[#18191c] dark:text-white",
        )}
      >
        {label}
        <ChevronDown className={cn("size-4 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 max-h-[70vh] w-72 overflow-y-auto rounded-lg border border-stroke bg-white shadow-lg dark:border-white/10 dark:bg-[#1b1c1f]">
          <button type="button" onClick={onAll} className="flex w-full items-center gap-3 border-b border-stroke px-4 py-3 text-left transition hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
            {box(all)}
            <span className="text-sm font-medium text-dark dark:text-white">All bookmarks</span>
          </button>
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 border-b border-stroke px-4 py-3 last:border-b-0 dark:border-white/10">
              <button type="button" onClick={() => onToggle(item.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                {box(selected.has(item.id))}
                <span className="min-w-0 flex-1 truncate text-sm text-dark dark:text-white">{item.label}</span>
                <span className={cn("ml-auto flex-shrink-0 text-xs", MUTED)}>{item.count}</span>
              </button>
              {item.tag && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    if (item.tag) onManage(item.tag);
                  }}
                  aria-label={`Manage ${item.label} tag`}
                  className="flex-shrink-0 rounded p-1 text-dark-5 transition hover:bg-gray-100 hover:text-dark dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <Settings2 className="size-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function BookmarksView({ initialLists, initialFollowedChannelIds }: { initialLists: FollowingListSummary[]; initialFollowedChannelIds: string[] }) {
  const [data, setData] = useState<{ bookmarks: BookmarkItem[]; tags: TagSummary[] } | null>(null);
  const [type, setType] = useState<"longform" | "shorts">("longform");
  const [selected, setSelected] = useState<Set<string>>(new Set([ALL]));
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [managedTag, setManagedTag] = useState<TagSummary | null>(null);

  const load = useCallback(
    () =>
      getJson<{ bookmarks: BookmarkItem[]; tags: TagSummary[] }>("/api/bookmarks")
        .then(setData)
        .catch(() => toast.error("Failed to load bookmarks")),
    [],
  );
  useEffect(() => {
    void load();
    const onUpdate = () => void load();
    window.addEventListener(BOOKMARKS_UPDATED, onUpdate);
    return () => window.removeEventListener(BOOKMARKS_UPDATED, onUpdate);
  }, [load]);

  useEffect(() => {
    const value = searchInput.trim();
    if (!value || value === search) return;
    const t = setTimeout(() => setSearch(value), 400);
    return () => clearTimeout(t);
  }, [searchInput, search]);

  // Tag filter: "All" or a mix of tags; "Untagged" excludes tags and vice versa (original rules).
  const toggleTag = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.delete(ALL);
      if (next.has(id)) {
        next.delete(id);
        if (!next.size) next.add(ALL);
      } else {
        if (id === UNTAGGED) for (const t of [...next]) next.delete(t);
        else next.delete(UNTAGGED);
        next.add(id);
      }
      return next;
    });

  const bookmarks = useMemo(() => data?.bookmarks ?? [], [data]);
  const visible = useMemo(() => {
    let list = bookmarks;
    if (selected.has(UNTAGGED)) list = list.filter((b) => b.tags.length === 0);
    else if (!selected.has(ALL)) list = list.filter((b) => b.tags.some((t) => selected.has(t)));
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((b) => b.video.title.toLowerCase().includes(q) || (b.video.channelName ?? "").toLowerCase().includes(q));
    }
    return list.filter((b) => (type === "shorts" ? b.isShort : !b.isShort)).map(toVideo);
  }, [bookmarks, selected, search, type]);

  const follow = useFollowState({ initialFollowed: initialFollowedChannelIds, initialLists });
  const actions = useVideoActions({
    onPatch: (videoId, p) => {
      setData((d) => (d ? { ...d, bookmarks: d.bookmarks.map((b) => (b.videoId === videoId ? { ...b, tags: p.bookmarkTags ?? b.tags, projectIds: p.projectIds ?? b.projectIds } : b)) } : d));
      setRecs((r) => (r ? { ...r, videos: r.videos.map((v) => (v.videoId === videoId ? { ...v, ...p } : v)) } : r));
    },
    onBookmarkRemoved: (videoId) => setData((d) => (d ? { ...d, bookmarks: d.bookmarks.filter((b) => b.videoId !== videoId) } : d)),
  });

  // ---- "Videos you might like"
  const [recs, setRecs] = useState<{ key: string; videos: Recommendation[]; hasMore: boolean } | null>(null);
  const [recRound, setRecRound] = useState(0);
  const shownRef = useRef<string[]>([]);
  // Wait for bookmarks so they can seed the topic pool (as the original does).
  const recKey = data ? `${type}:${recRound}` : null;
  const recsLoading = !recKey || recs?.key !== recKey;
  useEffect(() => {
    if (!recKey) return;
    let cancelled = false;
    const exclude = [...new Set([...readRecent(), ...shownRef.current])];
    const seed = bookmarks.slice(0, 12).map((b) => b.videoId);
    const url = (ex: string[]) => `/api/bookmarks/recommendations?type=${type}&limit=8&exclude=${ex.join(",")}&seed=${seed.join(",")}`;
    getJson<{ recommendations: Recommendation[]; hasMore: boolean }>(url(exclude))
      .then(async (res) => {
        // Rotated through everything recently: start over with a shorter memory.
        if (res.recommendations.length < 8 && exclude.length) res = await getJson(url(exclude.slice(0, 24)));
        if (cancelled) return;
        rememberRecent(res.recommendations.map((r) => r.videoId));
        setRecs({ key: recKey, videos: res.recommendations, hasMore: res.hasMore });
      })
      .catch(() => {
        if (!cancelled) setRecs({ key: recKey, videos: [], hasMore: false });
      });
    return () => {
      cancelled = true;
    };
    // Bookmarks only seed the first fetch of a round; re-fetching on every bookmark would reshuffle the grid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recKey]);

  const newSuggestions = () => {
    shownRef.current = [...shownRef.current, ...(recs?.videos ?? []).map((v) => v.videoId)];
    setRecRound((r) => r + 1);
  };

  const bookmarkRecommendation = async (video: Recommendation) => {
    // actions.bookmark emits BOOKMARKS_UPDATED, which reloads the list above.
    const ok = await actions.bookmark(video);
    if (!ok) return;
    const index = recs?.videos.findIndex((v) => v.videoId === video.videoId) ?? -1;
    setRecs((r) => (r ? { ...r, videos: r.videos.filter((v) => v.videoId !== video.videoId) } : r));
    // Refill the slot with one more suggestion.
    const exclude = [...new Set([...readRecent(), ...shownRef.current, ...(recs?.videos ?? []).map((v) => v.videoId)])];
    try {
      const res = await getJson<{ recommendations: Recommendation[]; hasMore: boolean }>(`/api/bookmarks/recommendations?type=${type}&limit=1&exclude=${exclude.join(",")}`);
      const next = res.recommendations[0];
      if (!next) return;
      rememberRecent([next.videoId]);
      setRecs((r) => {
        if (!r) return r;
        const videos = [...r.videos];
        videos.splice(Math.min(Math.max(index, 0), videos.length), 0, next);
        return { ...r, videos, hasMore: res.hasMore };
      });
    } catch {
      // the grid simply shows one fewer suggestion
    }
  };

  const recActions = {
    ...actions,
    bookmark: async (video: ResearchVideo) => {
      await bookmarkRecommendation(video as Recommendation);
      return true;
    },
  };

  const hasBookmarks = bookmarks.length > 0;
  return (
    <PageFrame
      title="Bookmarks"
      actions={
        hasBookmarks ? (
          <button type="button" onClick={() => setNewTagOpen(true)} className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary/90">
            <Plus className="size-4" />
            New tag
          </button>
        ) : undefined
      }
    >
      {!data ? (
        <GridSkeleton />
      ) : (
        <div className="space-y-6">
          {hasBookmarks && (
            <TagFilter selected={selected} tags={data.tags} bookmarks={bookmarks} onToggle={toggleTag} onAll={() => setSelected(new Set([ALL]))} onManage={setManagedTag} />
          )}
          <VideoTypeTabs
            value={type}
            onChange={setType}
            tabs={[
              { id: "longform", label: "Videos" },
              { id: "shorts", label: "Shorts" },
            ]}
          />
          {hasBookmarks ? (
            <>
              <SearchBox
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
                placeholder="Search bookmarks..."
                ariaLabel="Search bookmarks"
              />
              {visible.length === 0 ? (
                <EmptyState message="No bookmarks found matching your filters." />
              ) : (
                <>
                  <div className={GRID}>
                    {visible.map((v) => (
                      <ResearchVideoCard
                        key={v.videoId}
                        video={v}
                        followed={!!v.channelId && follow.followed.has(v.channelId)}
                        followPending={follow.isPending(v.channelId)}
                        onToggleFollow={() => void follow.toggleFollow(v)}
                        menu={<VideoActionsMenu video={v} actions={actions} variant="bookmarks" />}
                        footer={
                          v.bookmarkTags.length > 0 ? (
                            <div className="flex flex-wrap gap-1 pt-1">
                              {v.bookmarkTags.map((t) => (
                                <span key={t} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-dark-5 dark:bg-white/10 dark:text-gray-300">
                                  #{t}
                                </span>
                              ))}
                            </div>
                          ) : null
                        }
                      />
                    ))}
                  </div>
                  <p className={cn("py-3 text-center text-sm", MUTED)}>You&apos;re all caught up.</p>
                </>
              )}
            </>
          ) : (
            <EmptyState icon={<BookmarkIcon className="size-12 stroke-[1.4] text-dark-5" />} message="No bookmarks yet. Bookmark videos to save them here." />
          )}

          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-dark dark:text-white">Videos you might like</h2>
            {recsLoading && !recs?.videos.length ? (
              <GridSkeleton />
            ) : recs && recs.videos.length > 0 ? (
              <div className="space-y-4">
                <div className={GRID}>
                  {recs.videos.map((v) => (
                    <ResearchVideoCard
                      key={v.videoId}
                      video={v}
                      showSubscribers={false}
                      showTriggers={false}
                      followed={!!v.channelId && follow.followed.has(v.channelId)}
                      followPending={follow.isPending(v.channelId)}
                      onToggleFollow={() => void follow.toggleFollow(v)}
                      menu={<VideoActionsMenu video={v} actions={recActions} variant="following" />}
                    />
                  ))}
                </div>
                {recs.hasMore && (
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={newSuggestions}
                      disabled={recsLoading}
                      className="rounded-lg border border-stroke bg-white px-5 py-2.5 font-medium text-dark transition hover:bg-gray-100 disabled:opacity-50 dark:border-white/15 dark:bg-transparent dark:text-white dark:hover:bg-white/10"
                    >
                      {recsLoading ? "Loading..." : "Get new suggestions"}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <EmptyState className="py-8" message="Bookmark a few more videos to unlock suggestions." />
            )}
          </section>
        </div>
      )}

      <NewTagModal open={newTagOpen} onClose={() => setNewTagOpen(false)} onCreated={() => emit(BOOKMARKS_UPDATED)} />
      <ManageTagModal tag={managedTag} onClose={() => setManagedTag(null)} onUpdated={() => emit(BOOKMARKS_UPDATED)} />
      {actions.modals}
      {follow.modals}
      <ActionToaster />
    </PageFrame>
  );
}
