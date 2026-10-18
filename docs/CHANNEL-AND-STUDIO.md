# My Channel, Trophy Case, Video Performance and Studio (worker C)

What HookLab implements for these four screens, the evidence behind each behavior, and what is still unknown. Evidence labels: **[static]** read in the original's client bundles, **[runtime]** observed in captured data or in the live app (read-only, 2026-10-18), **[inferred]** a rule fitted to evidence, **[unknown]** not determined.

## Routes and APIs

| Page | Route | Server data | Client |
|---|---|---|---|
| My Channel | `/my-channel` | `getChannelSummary()` | `components/channel/MyChannelView.tsx` |
| Video Performance | `/my-channel/[videoId]` | `getChannelVideo()`, `getViewHistory()`, `getChangeHistory()` | `VideoPerformanceView.tsx` (recharts) |
| Trophy Case | `/my-channel/trophy-case` | `listTrophies()`, `getNextTargets()`, `getTrophyEligibility()` | `TrophyCaseView.tsx` |
| Studio | `/studio` (`?workspaceId=`, `?prefillTitle=`/`title`/`videoTitle`, `&videoId=`, `&projectName=`) | `getWorkspace()` | `components/studio/StudioView.tsx` (client-only, see below) |

| API | Shape |
|---|---|
| `GET /api/my-channel/videos?limit&cursor&sort&timeFilter&type&search&searchMode&minScore&maxScore&userChannelId` | `{success, data: {videos, nextCursor, hasMore, maxTotal: 200}}`. Video: `{id, videoId, title, thumbnail, views, videoUrl, publishAt, duration ("PT27M27S" / "P0D"), durationSeconds, isShort, isLivestream, periodViews, comparison: {avgViews, multiplier, rank, totalCompared, isTrueOutOfTen}, hasChanges}` |
| `GET /api/my-channel/videos/[videoId]` | `{success, data: {video, history: [{date, views, capturedAt}], changes}}` |
| `POST /api/my-channel/sync` `{userChannelId?, deep?, ifStale?}` | `202 {success, queued, runId, state}` or `{success, skipped, reason}` |
| `GET /api/my-channel/sync-status?userChannelId=` (also `GET /api/my-channel/sync`) | `{success, state: idle\|queued\|running\|completed\|failed, updatedAt, detail, pendingEnrichment, lastSyncedAt, runId, startedAt, finishedAt, stats, error}` |
| `GET /api/my-channel/trophies` | `{success, data: {channel, trophies, nextTargets, trophyEligibility}}` |
| `GET /api/my-channel/trophies/unseen`, `POST {ids}` | `{success, data: {trophies}}` / `{success, updated}` |
| `GET /api/studio/preview-videos?limit=&mode=niche\|random` (`broad` = random) | `{success, videos: [{id, videoId, title, thumbnail, views, publishAt, duration, Channel: {channelName, channelAvatar}}], meta: {requestedMode, appliedMode, supportsNiche, fallbackReason}}` |
| `POST /api/studio/thumbnails` multipart `file`, or JSON `{videoId}` | `201 {success, data: {publicUrl, key}}` (PNG/JPG/WEBP sniffed from bytes, max 5 MB) |
| `GET /api/studio/thumbnails/[key]` | the image (immutable cache) |
| `GET/POST /api/studio/workspaces`, `GET/PATCH/DELETE /api/studio/workspaces/[id]` | `{success, data: {workspace(s)}}`; PATCH takes `{name?, state?, projectId?}`; DELETE removes the row only (files stay) |

Tables this area adds (created with `CREATE TABLE IF NOT EXISTS` in its own modules): `channel_sync_runs`, `trophy_awards` (type, title, views/baseline at award for each `trophies` row), `video_change_history`, `channel_avatars` (Studio feed avatars). Uploads live in `data/studio-uploads/` and are indexed in `studio_assets` (`id` = file key).

## My Channel

- **[static]** `MyChannelView` (bundle `source-2`): header (96 px avatar, name, "View channel", "128K subscribers", "N videos", "Trophy Case"); type tabs Videos / Shorts / Livestreams shown only when the channel has Shorts or livestreams; time tabs All time / Last 7 Days / Last 30 Days / Last Year, each disabled until the first view snapshot is N days old (tooltip "7-day view will be available in N days", or "Sync your channel to enable time filters"); sort pills Latest / Oldest / Most views / Least views (Latest/Oldest hidden for time windows); "Outlier Score" tier multi-select (selecting tiers sorts by multiplier and keeps the min–max range); 400 ms search debounce, exact-substring mode; 24 per page with cursor, infinite scroll up to 200 then "Load more videos", "You're all caught up."; Shorts cards use a 9:16 thumbnail; the badge tooltip is "This video got 1.1x more views than your channel's recent average" or "…fewer views…"; the pencil starts a title chat with `Help me generate new title ideas for my video titled "<title>".` (HookLab links to `/chat?prompt=…`); a clock icon links to change history when `hasChanges`. Empty-state copy is the original's.
- **[runtime]** The original's API returns `maxTotal: 200` and `nextCursor` = last row id; the 306-video count = 105 long-form + 200 Shorts + 1 scheduled live stream ("Samin Yasar Live Stream", 0 views, thumbnail `hqdefault_live.jpg`).
- HookLab addition: "Synced 5 minutes ago" in the meta row doubles as a manual "Sync now" (the original only has "Retry" after a failed sync and syncs on visits).

### Outlier comparison rule **[inferred, verified]**

For each video, take the up-to-10 videos **of the same kind** (long-form, Shorts, live) published just before it.

- `avgViews` = `Math.round(mean views of those videos)` (the video itself excluded)
- `multiplier` = `views / avgViews`, rounded half-up to one decimal, as a string (`"1.1"`)
- `rank` = 1 + number of window videos with strictly more views, capped at the window size
- `totalCompared` = window size; the oldest video of each kind has no comparison (`null`)
- `isTrueOutOfTen` is `false` on every exported row **[unknown meaning]**

`lib/channel/outliers.ts` reproduces all 305 exported comparisons exactly (`data/account/my-channel-videos-{longform,shorts}.json`, checked with a script that diffs every row). **[runtime]** The live original returns identical comparisons for `sort=latest` (105/105 long-form) but different ones for `sort=popular`, and those also change with the page size; that looks like a window taken from the sorted query. HookLab keeps the publish-order window for every sort so a video's badge doesn't change with the sort.

### Sync

`POST /api/my-channel/sync` queues a background run (state in `channel_sync_runs`; one active run per channel; a run stuck > 10 min reads as failed). The page polls sync-status every 5 s like the original and starts a sync on visit when the last one is over 24 h old (the original's `ensureChannelVideosSynced`). A full keyless sync of Samin's channel takes about 4–5 s.

Sources, in order of trust:
1. **YouTube Data API** when `YOUTUBE_API_KEY` is set: `channels`, the typed uploads playlists, `videos` (exact everything). **Implemented but untested** (no key available); any API error falls back to the keyless path.
2. **RSS** (keyless, exact): `feeds/videos.xml?playlist_id=UULF…` (long-form), `UUSH…` (Shorts), `UULV…` (live), latest 15 each, with exact view counts in `media:statistics`. The typed playlists also give the Shorts/long-form/live split. RSS counts are cached and can lag a fresh upload.
3. **yt-dlp** `--flat-playlist --dump-single-json --playlist-end 200 --extractor-args youtubetab:approximate_date` on `/videos`, `/shorts`, `/streams` (Samin's channel has no Streams tab; that failure is expected). Checked real output: complete lists and durations, but view counts are YouTube's **truncated** display values ("45K" for 45,657, exact below 1,000), no exact publish time (day-level estimates on `/videos` only), and a listing title can be a **title-test variant** (cTFgEqOcUEo listed as "AI Influencers Just Changed Content Creation Forever!" while its page and RSS say "How AI Influencers Like Jean Phil Make Crazy Money").
4. **yt-dlp per video** (`-j --skip-download`, ~1.5 s each, 4 parallel): exact views, likes, comments, publish time and canonical title. Used for at most 40 videos per sync: new videos without a known date, and videos whose truncated listing count no longer fits the stored exact count (or whose RSS count lags the listing). `{deep: true}` refreshes every video this way (about 2 minutes).

Merging: exact counts win; otherwise a stored count is kept while it still fits the truncated bucket (`[45000, 46000)`), else the bucket floor is used. Titles change only from exact sources, and each change is written to `video_change_history` (thumbnail changes aren't detectable keylessly). Uploads with no known publish time get one interpolated between their listing neighbours. The original keeps at most 200 videos per kind **[runtime: maxTotal, 200 Shorts exported]**; HookLab lists 200 per kind from YouTube but never deletes stored rows. Each sync upserts `channel_videos`, appends one `video_view_snapshots` row per video, recomputes comparisons for the whole channel, updates the channel's subscribers/avatar/handle/video count, and awards trophies, all in one transaction.

Verified: two real syncs on 2026-10-18 (306 videos; 22 view counts moved; 0 false title changes; the scheduled live stream was picked up as the 306th video, matching the original's count).

### Time windows

`periodViews` = current views − the latest snapshot at or before now − N days (0 for videos published inside the window). The tabs stay disabled until snapshots cover the window, as in the original; Samin's history starts at the 2026-10-18 seed.

## Video Performance

**[runtime]** Original markup (live, read-only): "← Back" + "Video Performance", a card with the title (Roboto), "Total Views: 46K" (compact) and "View on YouTube →", and "Views Over Time": recharts, 400 px tall, dashed `#e5e7eb` grid, `#9ca3af` axes at 12 px, a `#2563eb` line with dots, `YYYY-MM-DD` x labels and compact y ticks. HookLab plots one point per day (the day's last snapshot) and adds a screen-reader table. The original's page bundle wasn't captured; the "Title changes" card is HookLab's reading of the `hasChanges` / `VideoChangeHistory` evidence **[inferred]**.

## Trophy Case

- **[static]** Milestones 100 / 1K / 10K / 100K / 1M / 10M, type `VIEW_MILESTONE`, theme colors per milestone, artwork sizes compact/card/hero, `grayscale` for upcoming trophies, titles like "100K Views", popup "Congratulations on crossing 100K views!" with Download and View Trophy Case, the 1080×1080 share card, the "How trophies work" sentences, hero milestone = the largest eligible/target milestone, and the Prisma model `CreatorTrophy {milestone, viewsAtAward, baselineViews, earnedAt, acknowledgedAt, …}` (bundles `source-33`, `source-14`, `source-27`, `source-17`).
- **[runtime]** Samin's modal: "Shorts: Since your Shorts often get 1K views, they're eligible for 10K-view trophies and above." / "Long-form videos: … often get 10K views … 100K-view trophies and above." / "Live streams: Your live streams are eligible for 100-view trophies." Upcoming Trophies showed 87,414→100K, 8,357→10K, 7,586→10K, 6,853→10K.
- **[inferred, matches that capture]** A kind's "often get" level is the median views of its 10 latest videos; the floor milestone ≤ that level is the label and the next milestone is the first eligible one ("and above"); with no floor (median < 100) only the 100-view trophy is eligible. Upcoming = every video's next eligible milestone above its views, top 4 by progress (reproduces the four cards exactly). A trophy is earned when a video's views pass an eligible milestone after tracking started: baseline = the video's first snapshot, or 0 for videos published after the channel was added.
- **[unknown]** Personal-record trophies (`MOST_VIEWED`, "New Most Viewed Video") exist in the bundle but their award rule doesn't; not implemented.
- The artwork is HookLab's own SVG trophy (`trophy-art.ts`), tinted with the original's milestone colors. The "New Trophy" popup is mounted in the My Channel layout (the original mounts it app-wide).

## Studio

**[static]** `StudioView` (`source-18`), `YouTubePreviewCard` / fonts / `ProjectHeaderButton` (`source-24`); **[runtime]** live screens of the landing, workspace, YouTube Preview, Devices and Share tabs (draft only, nothing uploaded or saved on the original).

- **Flow:** landing (drop or pick thumbnails, or type a title + Continue) → editor. Header "Studio / <workspace name ✎>", "New workspace" (confirm dialog), "Add to project". Tabs: Workspace, Devices, YouTube Preview, Tiny Test, Blur Test, Share. (The bundle also has Glance Test and Robot Reader views that its tab bar doesn't offer; not built.)
- **Model** (`components/studio/model.ts`, the original's snapshot v1): `titles`, `thumbnailTexts`, `thumbnails`, the selected indices of each, one shared `styleSettings {font, fontSize, fontColor, textAlign, textPosition, textPositionX/Y}` and `activeView`. Combos = selected titles × thumbnail texts × thumbnails. New items are auto-selected; removing an item shifts the selections.
- **Workspace tab:** sidebar lists with select/edit/remove, thumbnail tiles + "Add thumbnail" drop tile; style toolbar (8 fonts: Roboto, Impact, Montserrat, Bebas Neue, Oswald, Arial Black, Poppins, Inter; size 12–200; color swatches + picker + hex; align cycle), disabled with "Add thumbnail text to use these tools" until there's thumbnail text; combo cards with draggable text and corner resize handles (shared style, so all combos move together). HookLab uses its own swatch/native picker instead of the original's react-colorful.
- **YouTube Preview:** combos dealt into a feed of `max(12, 3n)` cards (mobile `max(6, 2n)`) of real library videos from `/api/studio/preview-videos`; Your niche / Random, Mobile / Desktop, Light / Dark, Scroll / Pause with 25–400 px/s, plus Shuffle. Niche = recent long-form library videos tagged with the active channel's `primaryNiches` (widening 7 → 30 → 120 days back from the newest library video), one per channel first, hidden channels excluded; falls back to Random with a reason. The library has no channel avatars, so they come from known channels and the channel page's `og:image`, cached in `channel_avatars` (2.5 s budget per request; the rest fill in the background). Light/Dark here themes only the feed (the original flips the whole app theme).
- **Devices** (Mobile / Desktop / Search / TV), **Tiny Test**, **Blur Test**, **Share** (1080×1350 PNG of the first 8 combos, "made with HookLab") follow the original's layouts and copy.
- **Persistence:** this tab's draft lives in `sessionStorage` (`hooklab.studio-draft`) as in the original. "Add to project" first saves the workspace (`POST /api/studio/workspaces`, URL becomes `/studio?workspaceId=<id>`), then opens the shared `AddToProjectModal` with `{kind: "studio", refId: <workspaceId>, payload: {workspaceId, name, href, thumbnail, titles}}`; on success the workspace records `projectId` and the header shows the project name. Saved workspaces autosave 1.2 s after changes (skipped while uploads are in flight) and can be renamed inline. Thumbnails upload immediately (local preview first, swapped for `/api/studio/thumbnails/<key>` when done); files over 5 MB are downscaled to a 1280 px JPEG first, as in the original.
- **Prefill:** `/studio?prefillTitle=<t>&videoId=<id>` adds/selects the title and copies that video's YouTube thumbnail into uploads (server-side fetch, `maxresdefault` → `sddefault` → `hqdefault`), then strips those params from the URL. Projects can open a saved workspace with `/studio?workspaceId=<id>`.
- Rendering is client-only (`next/dynamic` with `ssr: false`) because the first render restores the sessionStorage draft.

Verified on 2026-10-18: upload a JPEG through the file input → workspace with title + thumbnail text → YouTube Preview with 11 niche videos → Add to project (new project "Studio QA (worker C)") → autosave of a second title → a fresh tab at `/studio?workspaceId=…` restored both titles, the uploaded image and the project label; drag and corner-resize updated the shared style; the prefill URL produced the expected title + imported thumbnail; Share rendered its canvas.

## Screenshots

HookLab at 1440×900 in `docs/screenshots/channel-studio/` (compare with `evidence/screens/viewport/`). `trophy-popup.png` and `trophy-case-earned.png` show a temporary QA trophy that was removed afterwards.

## Known gaps

- YouTube Data API path is untested (no key).
- Thumbnail-change history and personal-record trophies aren't implemented (no keyless signal / unknown rule).
- The original's `pendingEnrichment` sync flag is always `false` here.
- View counts outside the latest 15 per kind (RSS) are exact only when the per-video refresh runs for them; otherwise they're the last exact value that still fits YouTube's truncated count.
- My Channel cards come from the shared `VideoCard`, which formats views with `formatCount` ("30.9K") where the original uses `Intl` compact notation ("31K", "6.8K"), and colors 0.3–1x badges with the "below average" tier gray (`text-gray-400`) where the original uses one gray (`text-gray-500`) for everything under 1x.
- The trophy popup only appears on My Channel pages (needs an AppShell mount to be app-wide).
- QA data left in the app DB: workspace "I Reverse Engineered Every App I Use" filed under project "Studio QA (worker C)", and test images in `data/studio-uploads/`.
