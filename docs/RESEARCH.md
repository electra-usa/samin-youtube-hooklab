# Research area (worker A): Outliers, Following, Bookmarks

HookLab's research pages, rebuilt from the REA captures of app.creatorhooks.com (2026-10-18).
Labels below are marked **[static]** (read in the original's client bundles), **[runtime]** (seen in
screenshots, outlines or the live app), **[inference]** (our reading of the evidence) or
**[unknown]** (not observable; HookLab's own choice).

## Evidence used

| Source | What it gave us |
|---|---|
| `evidence/scripts-all/files/isolated/source-28-*.js` (OutliersView) | filter model and defaults, `outlierMin/outlierMax` derivation, chips and their labels, "Return to default" / "Clear filters" rules, All filters sections, Save as default (PATCH), hide/undo flow, reference search URL params, empty states, infinite scroll [static] |
| `source-35/11/36-*.js` | `VideoCardActionsMenu` items, `OutlierScoreSlider` + `VIEWS_STEPS` / `FOLLOWING_VIEWS_STEPS`, `SearchInput`, `VideoGridSkeleton`, channel slug helpers, search-mode normalizer [static] |
| `source-7/22-*.js` (FollowingVideoCard, AddTagModal, ManageBookmarkModal) | card layout, Follow / Following / Unfollow pill, "Following X · Add to a list" toast + list picker, tag modals [static] |
| `source-31-*.js` (FollowingView) | Following header buttons, scope dropdown (All channels / Not in any list / lists), Follow-a-channel and New-list dialogs, sync badges, feed params, all empty-state strings [static] |
| `source-36/5-*.js` (ManageListModal) | Manage channels dialog: rename, add, remove-from-list vs unfollow confirmations, Delete list [static] |
| `source-30-*.js` (BookmarksView) | tag dropdown with counts, New tag / Manage Tag dialogs, Videos/Shorts tabs, "Videos you might like" with rotation of recently shown ids and "Get new suggestions" [static] |
| `source-2-*.js` | `VIDEO_LIMITS` (views floor 1K, ceiling 20M, Shorts ≤ 180 s) [static] |
| `source-14-*.js` | `/api/channels/add` body `{channelUrl, channelName, competitors?, inspirationChannels?}` [static] |
| `evidence/screens/{outliers,following,bookmarks}*` | layout, spacing, chip row, empty states, 3-column grid at 1440 px [runtime] |
| `evidence/css/*.css` | original `primary` is red (`#e02b27`, used for exclude ticks) and `secondary` is navy (HookLab `primary`) [static] |
| Live app (own BrowserOS tab, read-only) | "•••" menu, All filters modal, Niche dropdown appearance [runtime] |
| `data/account/user-outliers-preferences.json`, `following-lists.json`, channel profile | seeded defaults, hidden NBA channel, the two empty lists, `primaryNiches` [runtime] |

## Pages

### `/outliers`
- Filter bar: **Outlier Score** (7 tiers, dot + score badge), **Date** (Incl./Excl. windows; an excluded window must be shorter than the included one), **Click Trigger** (48, include/exclude, trigger-colored chips), **Niche** (45, include/exclude), **Views** (opens an inline 1K–20M+ step slider), **All filters**, search-mode select (Topic / Keyword / Title Formula / Thumbnail with the original descriptions) and the search box (400 ms debounce). Below 850 px the dropdowns collapse into "N filters applied" like the original.
- All filters modal: Video type (Long-form / Shorts, HookLab addition: the captured build hard-codes long-form), Outlier Score, Date, Niche and Click Trigger (6 rows + More/Less), Views, Subscribers (0–50M+), Title Format, Title Length (with the "This may limit…" hint under 75), Newsletter (featured / not featured), Hidden channels (chips with unhide). Footer: Clear filters, Save as default / Default saved / Saving..., Show videos.
- Chips use the original labels ("Outlier Score: 2x+", "Views: 10K - 20M+", "Exclude Niche: Geopolitics & Economics +2", "Topic Search: …", "Title Formula Search: …"). "Return to default" appears when filters differ from the saved default; "Clear filters" when they match it and at least two chips show. A channel filter shows the original "Filtered to: <channel> ×" pill (URL `?channel=<slug>-UC…`).
- Cards: shared `VideoCard` + `ChannelPill` Follow / Following (hover: Unfollow) and Hide (toast "Hidden X · Undo", 10 s), hover `ThumbAction`s (Find similar videos → topic reference search; View on YouTube), trigger chips add an include filter, channel name filters to the channel.
- "•••" menu: Bookmark → toast "Video bookmarked · Add tag" / Manage bookmark (tags + remove) / Remove bookmark, Add to a project (`AddToProjectModal`, kind `video`, `refId` = YouTube id), Generate titles using this formula (`/chat?prompt=Give me 5 titles for my channel using a similar format as this video: "<title>"`), Preview in Studio (`/studio?prefillTitle=…&videoId=…`), See similar topics / See more videos that use this title formula / See similar thumbnails, Copy title.
- 50 per page, IntersectionObserver on the `main` scroll container (200 px early), skeleton grid, "No outlier videos found. Try adjusting your filters." (the original's exact string; Following uses "No videos found. Try adjusting your filters."), "You're all caught up."
- Defaults: server-rendered from `getOutliersPreferences()` (same data as `GET /api/user/outliers-preferences`).

### `/following`
- Header: Follow channel, New list, Manage channels (when anything is followed). Scope dropdown: All channels / Not in any list / multi-select lists with channel counts. Videos | Shorts tabs. Filter bar reuses the Outliers components: Outlier (tiers), Date (incl./excl.), Views (0–20M+ following scale), "Search titles" (exact substring), Clear.
- Feed = library outliers of the followed channels + uploads from each channel's public RSS feed (`followed_videos`). RSS videos are scored against the channel's average (see approximations). Background sync starts for stale channels (> 30 min) on page load, after following, and on Retry; "● Syncing" and "N channels failed · Retry" badges as in the original.
- Dialogs: Follow a channel (search or paste URL/@handle/ID, optional "Add to list"), New list (name + channels), Manage channels (scope, rename on blur, add channel, membership chips with remove-from-list confirmation and "Also unfollow…", Unfollow, Delete list). Empty account (no lists, nothing followed): "Start tracking channels" search, which follows into a "My Channels" list like the original.
- Empty states (original strings): channel filter, "All your followed channels are in a list.", "This list has no channels yet.", "No videos found. Try adjusting your filters.", "Syncing your following channels' videos...", "No videos synced yet. Sync now to pull videos from YouTube." (+ Retry sync).

### `/bookmarks`
- Header "Bookmarks" + New tag (when there are bookmarks). Tag dropdown: All bookmarks, Untagged (count), each tag (count + gear → Manage Tag: rename on blur, Delete tag with confirm). Untagged and tags are mutually exclusive, as in the original. Videos | Shorts tabs, "Search bookmarks..." (title/channel).
- Bookmark card menu: Add tag, Remove bookmark, Add to a project, Generate titles…, Preview in Studio, similar searches (link to `/outliers?referenceVideoId=…`), Copy title. Tags show as small `#tag` chips under the card (HookLab addition).
- Empty: bookmark icon + "No bookmarks yet. Bookmark videos to save them here." / "No bookmarks found matching your filters."
- "Videos you might like": 8 suggestions (no subscriber count, no trigger chips, Follow only, as in the screenshot), "Get new suggestions" rotates; recently shown ids are kept 21 days in `localStorage` (`hooklab.bookmark-recommendations.recent`, max 60) and excluded, like the original's `bookmark-recommendations:recent`. Bookmarking a suggestion moves it into Bookmarks and refills the slot.
- Every bookmark/tag change emits `BOOKMARKS_UPDATED`; the page reloads on that event.

## APIs

| Route | Methods | Notes |
|---|---|---|
| `/api/outliers/videos` | GET | Original params: `type, sort (newest\|outlier\|views), page (0-based), search, searchMode (topic\|keyword\|title_pattern\|thumbnail), referenceVideoId (row id or YouTube id), channel (slug or UC id), outlierMin, outlierMax (999 = none), viewsMin, viewsMax (≥ 20M = none), subscriberMin, subscriberMax (≥ 50M = none), titleLengthMin, titleLengthMax, newsletterFeatured, publishDate, excludePublishDate, clickTriggers, niches, titleFormats, excludeClickTriggers, excludeNiches`. Returns `{success, videos ≤ 50, hasMore, page, referenceVideoId, searchMode, reference, notice?}`; videos are `toOutlierVideo` rows with `isBookmarked / bookmarkTags / projectIds` from app.db. 404 for an unknown reference. `Server-Timing: query;dur=…`. |
| `/api/user/outliers-preferences` | GET, PATCH, PUT | `{outliersDefaultFilters, hiddenChannelIds, hiddenChannels}`; body may carry `outliersDefaultFilters` (normalized like the original `z()`) and/or `hiddenChannels` / `hiddenChannelIds` (replaces the set, max 500). |
| `/api/following/lists` | GET, POST | GET `{lists: [{id, name, type, createdAt, channelIds, ChannelListItem: [...]}], followedChannelIds}`; POST `{name, type?, channels?}` → `{list, failed}` (409 on duplicate name). |
| `/api/following/lists/[id]` | PATCH, DELETE | rename `{name}`; delete removes memberships (channels stay followed). |
| `/api/following/lists/[id]/channels` | POST, DELETE | POST a channel object `{channelId, channelName?, channelAvatar?, subscriberCount?, handle?}` or `{url}` (URL/@handle, like `addChannelToListByUrl`); follows it too. DELETE `?channelId=` removes from this list only. |
| `/api/following/channels` | GET, POST, DELETE | GET management data `{channels: [... listMemberships], lists, followedChannelIds}`; POST follow `{channelId, channelName, …, listId? / listIds?}` (starts its sync); DELETE `?channelId=` unfollows (all lists, synced videos). |
| `/api/following/videos` | GET | `type, page, search (exact), channel, outlierMin/Max, viewsMin/Max, publishDate, excludePublishDate, listIds (csv) \| unlistedOnly=true` → `{success, videos, hasMore, page, totalChannels}`; items carry `source: "library" \| "feed"`. |
| `/api/following/sync` | POST | `{channelIds?, onlyStale?, onlyFailed?}` → status + `queued, queuedCount`. Fire-and-forget, 4 at a time. |
| `/api/following/sync-status` | GET | `{success, syncing, syncingCount, total, failedCount, failed[], lastSyncedAt}` |
| `/api/youtube/resolve-channel` | GET `?url=` | @handle, /@handle, /channel/UC…, /c/…, /user/…, bare UC id, video URL (via oEmbed) → `{channel: {channelId, name, handle, avatar, subscriberCount, channelName, channelAvatar, channelUrl}}`; 404 with the original's message when not found; 502 if YouTube is unreachable. |
| `/api/youtube/search-channels` | GET `?q=&maxResults=` | `{channels: [...same shape + source]}`: exact/prefix library matches, then YouTube's public search results (4 s budget, `youtube=0` disables), then looser library matches. |
| `/api/channels/add` | POST | `{channelUrl, channelName, competitors?, inspirationChannels?}` → adds a `user_channels` row (active only if none is) and follows the channels into "<name> - Competitors" / "<name> - Inspiration". |
| `/api/image-proxy` | GET `?url=` | Same-origin copy of ytimg / ggpht / googleusercontent images (15 MB cap, 1-day cache). |
| `/api/bookmarks` | GET, POST | GET `{bookmarks: [{id, videoId, isShort, createdAt, tags, projectIds, video}], tags}`; POST `{video}` or `{videoId}` (library data wins; 404 for unknown ids without a title). |
| `/api/bookmarks/[videoId]` | GET, DELETE | |
| `/api/bookmarks/[videoId]/tags` | POST, PUT, DELETE | POST `{tag}` / `{tags}` adds (creates tags), PUT replaces, DELETE `?tag=` removes. Returns `{tags}`. |
| `/api/bookmarks/tags` | GET, POST | `{tags: [{id, name, count}]}`; POST `{name}` (409 on duplicate). |
| `/api/bookmarks/tags/[id]` | PATCH, DELETE | `id` may be the tag id or its URL-encoded name (the original's actions were name-based). |
| `/api/bookmarks/recommendations` | GET | `type, limit (≤ 24), exclude (csv), seed (csv)` → `{status: "ready", recommendations: [... recommendationBucket, matchedNiche], hasMore, basis}`. |

## Approximations and inferences

- **Keyword search** [inference]: FTS5 match on the title column with every word required (quoted phrases stay phrases). The library index uses porter stemming, so "exact keywords" also match inflections.
- **Topic search** [inference; the original used topic embeddings, `hasTopicEmbedding`]: stopwords are dropped, the remaining words are OR-ed (plus the whole phrase as a boosting term), ranked by bm25 on the title in 0.5-wide bands, then newest first. A reference video uses its own title's topic words (filler words removed) and is excluded from its results.
- **Title Formula search** [inference]: each title is reduced to a skeleton — structural words (pronouns, prepositions, auxiliaries, formula verbs such as tried/made/stop/never, superlatives, time units), numbers (`#`, `$#`, `#%`, `#x`, `YEAR`) and punctuation are kept; topic words collapse into an `X` slot ("I Tried 100 AI Tools So You Don't Have To" → `i tried # X so you don't have to`). Skeletons are compared with a weighted Dice score over unigrams (1), bigrams (2), trigrams (3) and class bigrams (1; e.g. stop/never/don't, tried/tested, best/top). Matches ≥ 0.30 are returned best-first, then newest; a skeleton made only of very common grams (a bare topic like "Minecraft") matches identical skeletons. Typed queries can use slots: "how I made $X in N days", "[topic]". The index lives in memory (typed arrays, ~80 MB per 150K titles); the first formula search builds it (~1–2 s at 150K titles), later library swaps only append new rows. Active filters are applied in SQL to the top 3,000 candidates.
- **Thumbnail search** [unknown → fallback]: no image embeddings exist locally, so it runs topic search and the response carries a `notice` shown under the filter bar; the mode description in the selector says so too.
- **Following outlier scores** [inference]: library rows keep Creator Hooks' scores. RSS uploads are scored as `views / channel average`, where the average is the median of `views / outlierScore` over that channel's library rows (the average Creator Hooks itself implied), or else the mean views of the channel's settled (> 3 days) same-format feed uploads. Fresh uploads therefore start low and climb. RSS has no duration, so those cards show no duration badge; Shorts are recognised by their `/shorts/` link.
- **Recommendations** [inference; the original's buckets were `in_profile` + `targetNiche`]: three pools interleaved in an 8-slot pattern — `in_profile` (outlier ≥ 4, ≥ 10K views, last 90 days, the active channel's `primaryNiches`, spread across niches), `topic` (FTS on distinctive terms of the channel's own same-format titles plus bookmarked titles; tf-idf against the library, template words removed), `explore` (outlier ≥ 8, ≥ 50K views, last 60 days, no news / pop-culture / true-crime). Ranked by `sqrt(min(score, 25)) × log10(min(views, 2M)) × recency`; one video per channel; scores of 999x (data artifacts) are skipped; bookmarked, hidden and own-channel videos are excluded.
- **Hidden channels** [static + inference]: the original filtered hidden channels on the client; HookLab also excludes them in SQL so pages stay full.
- **Follow pill styling** uses the shared `ChannelPill` (accent-blue "Following") instead of the original navy tint.

## Performance (library at 147,639 rows, `EXPLAIN QUERY PLAN`)

| Query | Time | Plan |
|---|---|---|
| default filters, newest | 0.1 ms | `SCAN v USING INDEX videos_publish` (stops after 51 rows) |
| default, page 20 | 0.9 ms | same |
| sort=outlier | 0.1 ms | `SEARCH v USING INDEX videos_outlier` |
| rare niche include (≤ 4,000 rows) | 7 ms | drives from `video_niches_niche`, then `sqlite_autoindex_videos_1`, temp B-tree sort |
| common trigger include | 0.2 ms | publish-index walk with `instr(click_triggers, '"Curiosity"')` row checks |
| keyword FTS | 1.3 ms | `videos_fts` MATCH → rowid join |
| topic FTS + bm25 | 13 ms | `videos_fts` MATCH → rowid join → sort |
| worst case (filters that match nothing) | 67 ms | full publish-index walk |
| title formula (warm) | 20–30 ms | in-memory match + `json_each` id lookup |

Include filters pick their strategy per request: a niche/trigger set with ≤ 4,000 rows drives the query through its index; larger sets are checked per row with `instr()` on the JSON columns while walking the sort index. Excludes always use `instr() = 0`. Measured with a Node `node:sqlite` script running the generated SQL (5 runs, warm) against `data/creatorhooks.db`, and through the API (`Server-Timing` header).

## Gaps

- Original-only features not rebuilt: admin "Get bookmark link" / "Mark as featured in newsletter", onboarding coachmarks, usage analytics events, preview/upgrade gates (single-user app), the `newsletterBookmark` deep link.
- No image similarity (see thumbnail search). Topic search is lexical, so synonyms without shared words are missed.
- Following sync is in-process: failures are kept in memory (reset on server restart) and there is no periodic sync while the page is closed.
- Views on cards come from the shared `formatViews` (one decimal, "96.6K"); the original used compact notation ("97K").

## Verification

- `cd app && npx tsc --noEmit` — clean (whole app, at hand-off).
- `npx eslint` on every file listed above — 0 problems.
- Pages `/outliers`, `/following`, `/bookmarks` return 200 and were compared with `evidence/screens/viewport/*.png` at 1440×900 in a BrowserOS tab (layout, labels and empty states match; see screenshots in the worker report).
- API checks with curl: every filter, sort, paging, all four search modes, reference searches by row id and YouTube id, missing reference (404), hidden-channel exclusion, preference normalization, bookmarks/tags CRUD incl. duplicates (409) and unknown videos (404), lists/follows/sync/unfollow, resolve-channel (handle, channel URL, video URL, unknown), search-channels, channels/add, image-proxy allow/deny. Test data was removed afterwards.
