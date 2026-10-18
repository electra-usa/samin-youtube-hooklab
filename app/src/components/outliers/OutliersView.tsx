"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Info, SlidersHorizontal, X } from "lucide-react";
import { toast } from "@/components/ui/Toaster";
import { getJson, sendJson } from "@/lib/api-client";
import { CLICK_TRIGGERS, PERFORMANCE_TIERS } from "@/lib/taxonomy";
import {
  DEFAULT_TIER_IDS,
  SORTED_NICHES,
  SUBSCRIBERS_CEILING,
  TITLE_LENGTH_CEILING,
  VIEWS_CEILING,
  VIEWS_FLOOR,
  VIEWS_STEPS,
  compatibleWindows,
  createChannelSlug,
  normalizeOutlierFilters,
  normalizeSearchMode,
  outliersQuery,
  parseChannelId,
  parseChannelName,
  publishWindowLabel,
  sameFilters,
  searchModeLabel,
  searchPlaceholder,
  subscribersLabel,
  summarizeList,
  viewsLabel,
  type OutlierFilters,
  type SearchMode,
} from "@/lib/research/filters";
import type { FollowingListSummary, HiddenChannel, ResearchVideo } from "@/lib/research/types";
import { cn, timeAgo } from "@/lib/format";
import { useFollowState } from "@/components/following/useFollowState";
import { ActionToaster, actionToast } from "./ActionToast";
import { AllFiltersModal } from "./AllFiltersModal";
import { EmptyState, FILTER_ACTIVE_OUTLINE, GRID, GridSkeleton, InfiniteSentinel, MUTED, Spinner, filterButtonClass } from "./controls";
import { DateDropdown, IncludeExcludeDropdown, TierDropdown } from "./FilterDropdowns";
import { RangeSlider } from "./RangeSlider";
import { ResearchVideoCard, VideoActionsMenu } from "./ResearchVideoCard";
import { SearchBox, SearchModeSelect } from "./SearchBox";
import { useVideoActions } from "./useVideoActions";

type Reference = { id: string; mode: SearchMode; title: string };
type Result = { key: string; videos: ResearchVideo[]; hasMore: boolean; page: number; notice?: string };
type ApiResult = { videos: ResearchVideo[]; hasMore: boolean; notice?: string; error?: string };
type Prefs = { outliersDefaultFilters: OutlierFilters; hiddenChannels: HiddenChannel[] };

function parseReference(params: URLSearchParams): Reference | null {
  const id = params.get("referenceVideoId")?.trim();
  if (!id) return null;
  const mode = normalizeSearchMode(params.get("searchMode"), "keyword");
  if (mode === "keyword") return null;
  return { id, mode, title: params.get("referenceTitle")?.trim() || "Similar videos" };
}

const toggleIn = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

export function OutliersView({
  initialDefaults,
  initialHiddenChannels,
  initialLists,
  initialFollowedChannelIds,
}: {
  initialDefaults: OutlierFilters;
  initialHiddenChannels: HiddenChannel[];
  initialLists: FollowingListSummary[];
  initialFollowedChannelIds: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [savedDefault, setSavedDefault] = useState(() => normalizeOutlierFilters(initialDefaults));
  const [filters, setFilters] = useState(savedDefault);
  const patch = (p: Partial<OutlierFilters>) => setFilters((f) => ({ ...f, ...p }));
  const [hidden, setHidden] = useState(initialHiddenChannels);
  const hiddenIds = useMemo(() => new Set(hidden.map((h) => h.channelId)), [hidden]);

  // URL-driven state: ?search, ?searchMode, ?referenceVideoId (+referenceTitle), ?channel.
  const reference = useMemo(() => parseReference(new URLSearchParams(params.toString())), [params]);
  const channelParam = params.get("channel");
  const channelId = parseChannelId(channelParam);
  const urlSearch = params.get("search")?.trim() ?? "";
  const urlSig = `${urlSearch}|${params.get("searchMode") ?? ""}|${reference ? `${reference.id}:${reference.mode}` : ""}`;
  const [searchInput, setSearchInput] = useState(reference ? "" : urlSearch);
  const [search, setSearch] = useState(reference ? "" : urlSearch);
  const [searchMode, setSearchMode] = useState<SearchMode>(() =>
    reference ? reference.mode : urlSearch ? normalizeSearchMode(params.get("searchMode")) : "topic",
  );
  const [syncedSig, setSyncedSig] = useState(urlSig);
  if (urlSig !== syncedSig) {
    setSyncedSig(urlSig);
    if (reference) {
      setSearchInput("");
      setSearch("");
      setSearchMode(reference.mode);
    } else if (urlSearch) {
      setSearchInput(urlSearch);
      setSearch(urlSearch);
      setSearchMode(normalizeSearchMode(params.get("searchMode")));
    }
  }

  // Debounce typing into the active search (clearing applies immediately in onChange).
  useEffect(() => {
    const value = searchInput.trim();
    if (!value || value === search) return;
    const t = setTimeout(() => setSearch(value), 400);
    return () => clearTimeout(t);
  }, [searchInput, search]);

  const [allFiltersOpen, setAllFiltersOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [savingDefault, setSavingDefault] = useState(false);
  const viewsButtonRef = useRef<HTMLButtonElement>(null);
  const viewsPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!viewsOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!viewsPanelRef.current?.contains(t) && !viewsButtonRef.current?.contains(t)) setViewsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [viewsOpen]);

  // ---- data
  const queryKey = useMemo(
    () =>
      outliersQuery(filters, {
        page: 0,
        search: reference ? "" : search,
        searchMode,
        reference: reference ? { id: reference.id, mode: reference.mode } : null,
        channel: channelParam,
      }).toString(),
    [filters, search, searchMode, reference, channelParam],
  );
  const [result, setResult] = useState<Result | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const loading = result?.key !== queryKey;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/outliers/videos?${queryKey}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as ApiResult;
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error ?? "Failed to load videos");
        setResult({ key: queryKey, videos: body.videos ?? [], hasMore: !!body.hasMore, page: 0, notice: body.notice });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : "Failed to load videos");
        setResult({ key: queryKey, videos: [], hasMore: false, page: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [queryKey, refreshKey]);

  const loadMore = async () => {
    if (!result || loading || !result.hasMore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const q = new URLSearchParams(queryKey);
    q.set("page", String(result.page + 1));
    try {
      const body = await getJson<ApiResult>(`/api/outliers/videos?${q.toString()}`);
      setResult((r) => {
        if (!r || r.key !== queryKey) return r;
        const seen = new Set(r.videos.map((v) => v.id));
        return { ...r, videos: [...r.videos, ...body.videos.filter((v) => !seen.has(v.id))], hasMore: body.hasMore, page: r.page + 1 };
      });
    } catch {
      toast.error("Failed to load more videos");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  };

  const patchVideo = (videoId: string, p: Partial<ResearchVideo>) =>
    setResult((r) => (r ? { ...r, videos: r.videos.map((v) => (v.videoId === videoId ? { ...v, ...p } : v)) } : r));
  const actions = useVideoActions({ onPatch: patchVideo });
  const follow = useFollowState({ initialFollowed: initialFollowedChannelIds, initialLists });
  const videos = useMemo(() => (result?.videos ?? []).filter((v) => !v.channelId || !hiddenIds.has(v.channelId)), [result, hiddenIds]);

  // ---- filter helpers (mirroring the original's include/exclude rules)
  const toggleTier = (id: string) =>
    setFilters((f) => {
      const next = new Set(f.selectedTierIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...f, selectedTierIds: PERFORMANCE_TIERS.filter((t) => next.has(t.id)).map((t) => t.id) };
    });
  const includeDate = (id: string) => setFilters((f) => ({ ...f, publishDate: id, excludedPublishDate: compatibleWindows(id, f.excludedPublishDate) ? f.excludedPublishDate : "all" }));
  const excludeDate = (id: string) => setFilters((f) => ({ ...f, excludedPublishDate: id, publishDate: compatibleWindows(f.publishDate, id) ? f.publishDate : "all" }));
  const includeTrigger = (t: string) =>
    setFilters((f) => {
      const on = f.selectedClickTriggers.includes(t);
      return { ...f, selectedClickTriggers: toggleIn(f.selectedClickTriggers, t), excludedClickTriggers: on ? f.excludedClickTriggers : f.excludedClickTriggers.filter((x) => x !== t) };
    });
  const excludeTrigger = (t: string) =>
    setFilters((f) => {
      const on = f.excludedClickTriggers.includes(t);
      return { ...f, excludedClickTriggers: toggleIn(f.excludedClickTriggers, t), selectedClickTriggers: on ? f.selectedClickTriggers : f.selectedClickTriggers.filter((x) => x !== t) };
    });
  const includeNiche = (n: string) =>
    setFilters((f) => {
      const on = f.selectedNiches.includes(n);
      return { ...f, selectedNiches: toggleIn(f.selectedNiches, n), excludedNiches: on ? f.excludedNiches : f.excludedNiches.filter((x) => x !== n) };
    });
  const excludeNiche = (n: string) =>
    setFilters((f) => {
      const on = f.excludedNiches.includes(n);
      return { ...f, excludedNiches: toggleIn(f.excludedNiches, n), selectedNiches: on ? f.selectedNiches : f.selectedNiches.filter((x) => x !== n) };
    });

  const replaceUrl = (mutate: (p: URLSearchParams) => void, method: "push" | "replace" = "push") => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    const qs = next.toString();
    router[method](qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const clearReference = (method: "push" | "replace" = "push") =>
    replaceUrl((p) => {
      p.delete("referenceVideoId");
      p.delete("referenceTitle");
      if (!p.has("search")) p.delete("searchMode");
    }, method);

  const clearSearch = () => {
    setSearchInput("");
    setSearch("");
  };

  const clearFilters = () => {
    setFilters({ ...normalizeOutlierFilters({}), selectedTierIds: [], viewsMin: VIEWS_FLOOR, excludedNiches: [] });
    setViewsOpen(false);
    clearSearch();
    setSearchMode("topic");
    if (reference) clearReference();
  };

  const returnToDefault = () => {
    setFilters(savedDefault);
    setViewsOpen(false);
    clearSearch();
    setSearchMode("topic");
    if (reference) clearReference();
  };

  const saveDefault = async () => {
    setSavingDefault(true);
    try {
      const res = await sendJson<Prefs>("/api/user/outliers-preferences", "PATCH", { outliersDefaultFilters: filters });
      setSavedDefault(normalizeOutlierFilters(res.outliersDefaultFilters));
      toast.success("Default filters saved");
    } catch {
      toast.error("Failed to save default filters");
    } finally {
      setSavingDefault(false);
    }
  };

  const saveHidden = (list: HiddenChannel[]) =>
    sendJson<Prefs>("/api/user/outliers-preferences", "PATCH", { hiddenChannels: list }).then((r) => r.hiddenChannels);

  const hideChannel = async (video: ResearchVideo) => {
    const id = video.channelId;
    if (!id || hiddenIds.has(id)) return;
    const name = video.channelName ?? id;
    const before = hidden;
    const next = [...hidden, { channelId: id, channelName: name }];
    setHidden(next);
    try {
      setHidden(await saveHidden(next));
      actionToast(
        <>
          Hidden <strong>{name}</strong>
        </>,
        "Undo",
        () => {
          setHidden(before);
          saveHidden(before)
            .then((list) => {
              setHidden(list);
              toast.success("Channel restored");
            })
            .catch(() => toast.error("Failed to undo hide"));
        },
        10_000,
      );
    } catch {
      setHidden(before);
      toast.error("Failed to hide channel");
    }
  };

  const unhideChannel = async (id: string) => {
    const target = hidden.find((h) => h.channelId === id);
    if (!target) return;
    const before = hidden;
    setHidden(hidden.filter((h) => h.channelId !== id));
    try {
      setHidden(await saveHidden(hidden.filter((h) => h.channelId !== id)));
      setRefreshKey((k) => k + 1);
      toast.success(`Unhid ${target.channelName}`);
    } catch {
      setHidden(before);
      toast.error("Failed to unhide channel");
    }
  };

  const filterToChannel = (id: string, name: string) => replaceUrl((p) => p.set("channel", createChannelSlug(id, name)));
  const clearChannel = () => replaceUrl((p) => p.delete("channel"));

  const startReferenceSearch = (video: ResearchVideo, mode: SearchMode) => {
    clearSearch();
    setSearchMode(mode);
    const next = new URLSearchParams(params.toString());
    next.set("referenceVideoId", video.id);
    next.set("searchMode", mode);
    if (video.title.trim()) next.set("referenceTitle", video.title.trim());
    else next.delete("referenceTitle");
    next.delete("search");
    router.push(`${pathname}?${next.toString()}`);
    document.querySelector("main")?.scrollTo({ top: 0 });
  };

  // ---- chips & flags (same rules as the original)
  const tierSet = new Set(filters.selectedTierIds);
  const partialTiers = tierSet.size > 0 && tierSet.size < PERFORMANCE_TIERS.length;
  const viewsChanged = filters.viewsMin !== VIEWS_FLOOR || filters.viewsMax !== VIEWS_CEILING;
  const subsChanged = filters.subscriberMin !== 0 || filters.subscriberMax !== SUBSCRIBERS_CEILING;
  const lengthChanged = filters.titleLengthMin !== 0 || filters.titleLengthMax !== TITLE_LENGTH_CEILING;
  const tierChip = !partialTiers
    ? null
    : filters.selectedTierIds.join() === DEFAULT_TIER_IDS.join()
      ? "2x+"
      : summarizeList(PERFORMANCE_TIERS.filter((t) => tierSet.has(t.id)).map((t) => t.label));

  const chips: { id: string; label: string; value: string; onRemove: () => void }[] = [
    ...(filters.videoType === "shorts" ? [{ id: "type", label: "Video Type", value: "Shorts", onRemove: () => patch({ videoType: "longform" }) }] : []),
    ...(tierChip ? [{ id: "tiers", label: "Outlier Score", value: tierChip, onRemove: () => patch({ selectedTierIds: [] }) }] : []),
    ...(filters.publishDate !== "all" ? [{ id: "date", label: "Date", value: publishWindowLabel(filters.publishDate), onRemove: () => patch({ publishDate: "all" }) }] : []),
    ...(filters.excludedPublishDate !== "all"
      ? [{ id: "xdate", label: "Exclude Date", value: publishWindowLabel(filters.excludedPublishDate), onRemove: () => patch({ excludedPublishDate: "all" }) }]
      : []),
    ...(viewsChanged
      ? [
          {
            id: "views",
            label: "Views",
            value: `${viewsLabel(filters.viewsMin)} - ${viewsLabel(filters.viewsMax)}`,
            onRemove: () => {
              patch({ viewsMin: VIEWS_FLOOR, viewsMax: VIEWS_CEILING });
              setViewsOpen(false);
            },
          },
        ]
      : []),
    ...(subsChanged
      ? [
          {
            id: "subs",
            label: "Subscribers",
            value: `${subscribersLabel(filters.subscriberMin)} - ${subscribersLabel(filters.subscriberMax)}`,
            onRemove: () => patch({ subscriberMin: 0, subscriberMax: SUBSCRIBERS_CEILING }),
          },
        ]
      : []),
    ...(lengthChanged
      ? [
          {
            id: "length",
            label: "Title Length",
            value: `${filters.titleLengthMin} - ${filters.titleLengthMax} chars`,
            onRemove: () => patch({ titleLengthMin: 0, titleLengthMax: TITLE_LENGTH_CEILING }),
          },
        ]
      : []),
    ...(filters.newsletterFeatured !== "all"
      ? [
          {
            id: "newsletter",
            label: "Newsletter",
            value: filters.newsletterFeatured === "featured" ? "Featured" : "Not featured",
            onRemove: () => patch({ newsletterFeatured: "all" }),
          },
        ]
      : []),
    ...(filters.selectedTitleFormats.length
      ? [{ id: "format", label: "Title Format", value: summarizeList(filters.selectedTitleFormats), onRemove: () => patch({ selectedTitleFormats: [] }) }]
      : []),
    ...(filters.selectedClickTriggers.length
      ? [{ id: "trigger", label: "Click Trigger", value: summarizeList(filters.selectedClickTriggers), onRemove: () => patch({ selectedClickTriggers: [] }) }]
      : []),
    ...(filters.excludedClickTriggers.length
      ? [{ id: "xtrigger", label: "Exclude Trigger", value: summarizeList(filters.excludedClickTriggers), onRemove: () => patch({ excludedClickTriggers: [] }) }]
      : []),
    ...(filters.selectedNiches.length ? [{ id: "niche", label: "Niche", value: summarizeList(filters.selectedNiches), onRemove: () => patch({ selectedNiches: [] }) }] : []),
    ...(filters.excludedNiches.length
      ? [{ id: "xniche", label: "Exclude Niche", value: summarizeList(filters.excludedNiches), onRemove: () => patch({ excludedNiches: [] }) }]
      : []),
    ...(reference ? [{ id: "reference", label: `${searchModeLabel(reference.mode)} Search`, value: reference.title, onRemove: () => clearReference() }] : []),
    ...(search && !reference ? [{ id: "search", label: `${searchModeLabel(searchMode)} Search`, value: search, onRemove: clearSearch }] : []),
  ];

  const filtersActive =
    partialTiers ||
    filters.videoType === "shorts" ||
    filters.publishDate !== "all" ||
    filters.excludedPublishDate !== "all" ||
    viewsChanged ||
    subsChanged ||
    lengthChanged ||
    filters.newsletterFeatured !== "all" ||
    filters.selectedClickTriggers.length > 0 ||
    filters.selectedNiches.length > 0 ||
    filters.selectedTitleFormats.length > 0 ||
    filters.excludedClickTriggers.length > 0 ||
    filters.excludedNiches.length > 0;
  const anyActive = filtersActive || !!search || !!reference;
  const isDefault = sameFilters(filters, savedDefault);
  const showReturn = !isDefault;
  const showClear = anyActive && isDefault && chips.length >= 2;
  const notice = result?.key === queryKey ? result.notice : undefined;
  const channelName = channelId
    ? videos.find((v) => v.channelId === channelId)?.channelName || parseChannelName(channelParam) || channelId
    : null;

  const textButton =
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] transition hover:bg-gray-100 hover:text-dark dark:hover:bg-white/10 dark:hover:text-white";

  return (
    <div className="space-y-4">
      <LibraryFreshness />
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

        <div className="flex flex-wrap items-center gap-2">
          <div className="hidden min-[850px]:contents">
            <TierDropdown selected={tierSet} onToggle={toggleTier} />
            <DateDropdown include={filters.publishDate} exclude={filters.excludedPublishDate} onInclude={includeDate} onExclude={excludeDate} />
            <IncludeExcludeDropdown
              label="Click Trigger"
              options={CLICK_TRIGGERS}
              included={new Set(filters.selectedClickTriggers)}
              excluded={new Set(filters.excludedClickTriggers)}
              onInclude={includeTrigger}
              onExclude={excludeTrigger}
              colorTriggers
            />
            <IncludeExcludeDropdown
              label="Niche"
              options={SORTED_NICHES}
              included={new Set(filters.selectedNiches)}
              excluded={new Set(filters.excludedNiches)}
              onInclude={includeNiche}
              onExclude={excludeNiche}
            />
            <button
              ref={viewsButtonRef}
              type="button"
              onClick={() => setViewsOpen((o) => !o)}
              aria-expanded={viewsOpen}
              className={filterButtonClass(viewsOpen || viewsChanged, FILTER_ACTIVE_OUTLINE)}
            >
              Views
              <ChevronDown className={cn("size-4 transition", viewsOpen && "rotate-180")} />
            </button>
          </div>
          <button type="button" onClick={() => setAllFiltersOpen(true)} aria-expanded={allFiltersOpen} className={filterButtonClass(allFiltersOpen || filtersActive)}>
            <SlidersHorizontal className="size-4" />
            All filters
          </button>
          <div className="order-first flex min-w-[280px] max-w-full flex-[1_0_100%] items-stretch rounded-lg border border-stroke bg-white focus-within:ring-2 focus-within:ring-primary dark:border-white/10 dark:bg-[#18191c] min-[850px]:order-none min-[850px]:max-w-xl min-[850px]:flex-1">
            <SearchModeSelect value={searchMode} onChange={setSearchMode} />
            <SearchBox
              embedded
              className="min-w-0 flex-1"
              value={searchInput}
              onChange={(v) => {
                setSearchInput(v);
                if (!v.trim()) setSearch("");
                if (reference && v.trim()) clearReference("replace");
              }}
              onSubmit={() => setSearch(searchInput.trim())}
              onClear={clearSearch}
              placeholder={searchPlaceholder(searchMode)}
              ariaLabel={`${searchModeLabel(searchMode)} search videos`}
            />
          </div>
          {chips.length > 0 && (
            <button
              type="button"
              onClick={() => setAllFiltersOpen(true)}
              aria-label={`${chips.length} filters applied. Open all filters.`}
              className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary dark:text-white min-[850px]:hidden"
            >
              {chips.length} filter{chips.length === 1 ? "" : "s"} applied
            </button>
          )}
          {showReturn && (
            <button type="button" onClick={returnToDefault} className={cn(textButton, "min-[850px]:hidden")}>
              Return to default
            </button>
          )}
          {anyActive && !showReturn && (
            <button type="button" onClick={clearFilters} className={cn(textButton, "min-[850px]:hidden")}>
              <X className="size-3.5" />
              Clear
            </button>
          )}
        </div>

        {(chips.length > 0 || showReturn || showClear) && (
          <div className="hidden flex-wrap items-center gap-2 min-[850px]:flex" aria-label="Active filters">
            {chips.map((c) => (
              <span
                key={c.id}
                className={cn(
                  "inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary dark:border-sky-400/40 dark:bg-sky-400/15 dark:text-white",
                  c.label.includes("Search") && "sm:max-w-[280px]",
                )}
              >
                <span className="truncate">
                  <span className="font-semibold">{c.label}:</span> {c.value}
                </span>
                <button
                  type="button"
                  onClick={c.onRemove}
                  aria-label={`Remove ${c.label} filter`}
                  className="-mr-1 flex size-5 shrink-0 items-center justify-center rounded-full transition hover:bg-primary/15"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            {showReturn && (
              <button type="button" onClick={returnToDefault} className={textButton}>
                Return to default
              </button>
            )}
            {showClear && (
              <button type="button" onClick={clearFilters} className={textButton}>
                <X className="size-3.5" />
                Clear filters
              </button>
            )}
          </div>
        )}

        {viewsOpen && (
          <div ref={viewsPanelRef} className="hidden max-w-[420px] min-[850px]:block">
            <p className={cn("mb-1.5 text-xs font-medium", MUTED)}>
              Views: {viewsLabel(filters.viewsMin)} - {viewsLabel(filters.viewsMax)}
            </p>
            <RangeSlider label="Views" steps={VIEWS_STEPS} min={filters.viewsMin} max={filters.viewsMax} format={viewsLabel} onChange={(viewsMin, viewsMax) => patch({ viewsMin, viewsMax })} />
          </div>
        )}

        {notice && (
          <p className={cn("flex items-start gap-2 text-xs", MUTED)}>
            <Info className="mt-px size-3.5 shrink-0" />
            {notice}
          </p>
        )}
      </div>

      <AllFiltersModal
        open={allFiltersOpen}
        onClose={() => setAllFiltersOpen(false)}
        filters={filters}
        onChange={patch}
        onToggleTier={toggleTier}
        onIncludeDate={includeDate}
        onExcludeDate={excludeDate}
        onIncludeTrigger={includeTrigger}
        onExcludeTrigger={excludeTrigger}
        onIncludeNiche={includeNiche}
        onExcludeNiche={excludeNiche}
        onClear={clearFilters}
        onSaveDefault={saveDefault}
        savingDefault={savingDefault}
        isDefault={isDefault}
        hiddenChannels={hidden}
        onUnhide={unhideChannel}
      />

      {loading ? (
        <GridSkeleton />
      ) : videos.length === 0 ? (
        <EmptyState
          message={channelId ? `No videos found from ${channelName || "this channel"}.` : "No outlier videos found. Try adjusting your filters."}
          action={
            channelId ? (
              <button type="button" onClick={clearChannel} className="text-sm text-primary hover:underline dark:text-sky-300">
                Clear filter
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className={GRID}>
            {videos.map((v) => (
              <ResearchVideoCard
                key={v.id}
                video={v}
                followed={!!v.channelId && follow.followed.has(v.channelId)}
                followPending={follow.isPending(v.channelId)}
                onToggleFollow={() => void follow.toggleFollow(v)}
                onHide={v.channelId ? () => void hideChannel(v) : undefined}
                onChannelClick={filterToChannel}
                onTriggerClick={includeTrigger}
                activeTriggers={filters.selectedClickTriggers}
                onFindSimilar={() => startReferenceSearch(v, "topic")}
                menu={<VideoActionsMenu video={v} actions={actions} onReferenceSearch={(mode) => startReferenceSearch(v, mode)} />}
                footer={<NewMarker video={v} />}
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

      {actions.modals}
      {follow.modals}
      <ActionToaster />
    </div>
  );
}

// ---- live pipeline freshness (src/lib/core/ingest): a subtitle line and a "New" marker

type Freshness = { updatedAt: string | null; running: boolean; newOutliers24h: number };

/** "Library updated 12 minutes ago · 340 new outliers today", refreshed every minute. */
function LibraryFreshness() {
  const [data, setData] = useState<Freshness | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/v1/refresh/freshness", { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<Freshness>) : null))
        .then((body) => {
          if (!cancelled && body) setData(body);
        })
        .catch(() => {});
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  if (!data?.updatedAt) return null;
  const n = data.newOutliers24h;
  return (
    <p className="-mt-4 text-sm text-dark-5 dark:text-gray-400">
      Library updated {timeAgo(data.updatedAt)}
      {data.running ? " · refreshing now" : ""}
      {n > 0 ? ` · ${n.toLocaleString("en-US")} new outlier${n === 1 ? "" : "s"} today` : ""}
    </p>
  );
}

/** Uploads from the last 24 hours that the live pipeline found (rows it inserts are `rss:<videoId>`). */
function NewMarker({ video }: { video: ResearchVideo }) {
  const [isNew] = useState(
    () => video.id.startsWith("rss:") && !!video.publishAt && Date.now() - Date.parse(video.publishAt) < 86_400_000,
  );
  if (!isNew) return null;
  // "New upload", not "New": the click-trigger chips above include a trigger called "New".
  return (
    <span
      className="brand-accent-chip mt-1 inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      title="Uploaded in the last 24 hours and found by the live refresh"
    >
      <span className="size-1.5 rounded-full bg-green-600 dark:bg-green-400" aria-hidden />
      New upload
    </span>
  );
}
