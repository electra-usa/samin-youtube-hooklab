# Projects and Settings (worker D)

What HookLab's Projects pages, Settings tabs (Profile, Channels, Billing, Teams) and the small account APIs do, what evidence they are built from, and where they differ from Creator Hooks.

## Routes

| Route | Notes |
|---|---|
| `/projects` | List, search (client-side), status filter (`?status=idea\|in_progress\|published`), create / edit / delete modals, status chip on each card. Empty states copy the original's. |
| `/projects/[id]` | Editable name and description (saved on blur or Enter), status menu, Edit details (linked channel) and Delete. Sections: Chats, Saved titles, Videos, Notes, Studio workspaces. Unknown ids return 404. |
| `/settings` | Tabs live in the hash (`#profile`, `#channels`, `#billing`, `#teams`), as in the original. `?tab=channels` picks the tab when there's no hash, and `?tab=channels&add=1` also opens Add Channel. |

## APIs

All routes return JSON, and errors come back as `{ error }` with a 4xx status.

| Method and path | Shape and behavior |
|---|---|
| `GET /api/projects?q=&status=` | `{ projects: ProjectSummary[] }` with `{id,name,description,status,createdAt,updatedAt,itemCount,primaryChannelId,primaryChannelName,primaryChannelAvatar}`, newest first. |
| `POST /api/projects` | `{name, description?, status?, primaryChannelId?}` returns `201 { project }`. The channel defaults to the active channel, as in the original `createProject`. |
| `GET/PATCH/DELETE /api/projects/[id]` | GET returns `ProjectDetail` (`project`, `chats`, `titles`, `videos`, `studio`, `notes`). PATCH accepts `name`, `description`, `status` (any case) and `primaryChannelId`. DELETE removes the project and its items, and unassigns its chats, pins and Studio workspaces without deleting them. |
| `GET/POST /api/projects/[id]/items` | POST takes `{kind, refId?, payload?}` and returns `{ item, created }`. `kind` is `chat` (needs the chat id; also sets `chats.project_id` and moves the chat out of any other project), `title` (`payload.title`), `video` or `bookmark` (video id as `refId` or `payload.videoId`; the payload can be the full Outliers video object), `studio` (workspace id) or `note` (`payload.text`). Sending the same chat, video, workspace or title text again returns the existing item. |
| `PATCH/DELETE /api/projects/[id]/items/[itemId]` | PATCH edits a note or title. DELETE also accepts `chat:<id>`, `pin:<id>` and `studio:<id>`, the entry ids the detail view uses for links stored on other rows. |
| `GET/POST /api/user/channels`, `DELETE /api/user/channels/[id]` | `{ channels, activeChannelId }` in the original shape. POST adds a channel already resolved by `/api/youtube/resolve-channel` and accepts either field-name style (`name`/`avatar` or `channelName`/`channelAvatar`). DELETE removes the channel's profile, style guide, chat preferences and synced videos, and picks a new active channel if needed. |
| `GET/PATCH /api/user/channel-profile?userChannelId=` | `{ profile:{overview,aboutMyChannel?,channelId,generatedAt,basedOnVideoCount}\|null, generatedAt, primaryNiches, topics }`. PATCH takes `overview`, `aboutMyChannel`, `primaryNiches` and `topics`. Topics are lowercased, deduplicated and capped at 12. |
| `GET/PATCH /api/user/style-guide?userChannelId=` | `{ styleGuide, userChannelId }`. The style guide has `maxTitleLength` (0–100), `minThumbnailWords`/`maxThumbnailWords` (0–10), `bannedPunctuation` (a JSON-array string, as in the original), `bannedWordsPhrases` and `scriptWritingRules`. |
| `GET/PATCH /api/user/chat-preferences?userChannelId=` | `{ chatPreferences, dataSources:{lists,bookmarkTags} }`. The preferences have `listIdsToUse` and `bookmarkTagsToUse` (`null` means all), `listInstructions` (keyed by list id) and `additionalInstructions`. |
| `GET /api/user/channel-limit` | `{maxChannels, channelCount, atLimit, upgradeMessage, canManageBilling}`. |
| `GET/PATCH /api/user/content-languages` | `{selectedContentLanguages, labels}`, stored in the `contentLanguages` setting. An empty list means all languages. |
| `GET/PATCH /api/user/email-preferences` | `{weeklyIdeasEmailOptIn, featuredChannelIds}`. Stored locally only; no email is sent. |
| `POST /api/user/update` | `{name, email}` updates `users`. |
| `GET /api/user/trial-status` | The original paying-customer shape: `{status:"ACTIVE", expired, isPostTrialGrace, isPayingCustomer, canUpgradeCreditPlan, creditPacksAvailable, creditLimit, usedCredits, creditsRemaining, creditPeriodEndsAt, creditWarningLevel}`, plus `plan` and `local`. |
| `GET/POST /api/user/team`, `POST/DELETE /api/user/team/[id]` | GET returns the team (owner, members, pending invites) and seat limits. POST invites `{email}`. `POST [id] {action:"resend"\|"accept"}` renews an invite or marks it joined. DELETE removes a member or invite. |
| `POST /api/user/reset` | `{confirm:"RESET"}` is the Danger Zone action. It empties every table in `data/app.db` and re-imports the account export. The library DB is not touched. |
| `POST /api/user/change-password` | Returns 501: there's no sign-in locally. |
| `GET /api/billing`, `POST /api/billing/plan`, `POST /api/billing/credit-pack` | See Local billing below. |
| `GET/POST /api/getting-started` | GET returns `{eligible, completionDismissed, latestTitleChatId, steps, coachmarks}`. POST accepts the original's `complete_titles`, `discover_coachmark` and `dismiss_completion` actions, plus `complete_search`, added for Outliers. |
| `GET /api/announcements/current`, `POST /api/announcements/[id]/dismiss` | Always `{announcement:null}`; dismissals are remembered in a setting. |

## Storage

- **Existing tables used:** `projects`, `project_items`, `chats.project_id`, `pinned_titles.project_id`, `studio_workspaces.project_id`, `users`, `user_channels`, `channel_profiles`, `style_guides`, `chat_preferences` and `settings`. Reads only: `credit_usage`, `following_lists`, `tags`, `bookmarks` and library `videos`.
- **New tables:** created with `CREATE TABLE IF NOT EXISTS` in each owning module.
  - `project_channels`: a project's linked channel (original `Project.primaryChannelId`).
  - `billing_ledger`: local plan changes and packs.
  - `team_members`: local invites and members.
- **Settings keys:**
  - `credits`: `{plan, interval, planCredits, grantedCredits, monthlyLimit, periodStartsAt, periodEndsAt, updatedAt}`. The seed's `plan`, `monthlyLimit` and `periodEndsAt` keep their meaning, and `monthlyLimit` is now the effective limit including packs.
  - `contentLanguages`, `emailPreferences` (`weeklyIdeas` kept in sync with `weeklyIdeasEmailOptIn`), `gettingStarted` and `announcements.dismissed`.
- **Shapes:** `channel_profiles.profile_json` keeps the original body shape. `style_guides.content` holds JSON (older free-text rows are read as writing rules). `chat_preferences.prefs_json` keeps the original object.

## Local billing

HookLab has no payment processor, and the Billing tab says so in a banner.

- **Plans:** switching updates the `credits` setting and adds a ledger row. It never charges. The plan sets the monthly credit allowance (Creator 500, Pro 3,000, Agency 7,000) and the channel and seat limits. Changes apply immediately in both directions; the original scheduled some downgrades.
  - Downgrades are refused while the user has more channels or members than the target plan allows.
  - Switching to the plan you're already on returns a 400.
- **Credit packs:** "Add 250 credits · $5" and "Add 550 credits · $10" add one-time credits to the current period (`grantedCredits`). They disappear when the period rolls over.
- **Period:** credits reset monthly, on annual billing too. The current period is `[periodEndsAt − 1 month, periodEndsAt)`, seeded from the export's `creditPeriodEndsAt` (Nov 9, 02:32 UTC, which shows as "Resets Nov 8" in US time zones). Any read after the end rolls it forward, keeping the original day of the month where possible, and clears pack credits.
- **Usage:** the sum of `credit_usage.credits` (written by Chat) inside the period. The original screen showed 10 credits used from the real account; HookLab counts only local usage.
- **Warning levels (inferred):** `near` from 80% used, `critical` from 95%, `exhausted` at 100%. These come from the original's copy, "You've used 80%…" and "Only N … credits remain".
- **Prices:** the monthly price is derived as `(annualTotal + annualSavings) / 12`, giving Creator $19, Pro $49 and Agency $99. The annual monthly equivalent is `round(annualTotal / 12)`: $14, $37 and $74.
  - Evidence: the original computes `yearlySavings = 12 × monthlyPrice − annualPrice` and shows `round(annualPrice/12)` when a card's "Billed yearly" toggle is on. The screenshot has Creator and Agency toggled on and Pro off.
  - So `data/pricing.json`'s `monthlyPrice` of 14 and 74 is the yearly equivalent, not the monthly price. That file isn't mine, so the code corrects for it rather than editing it.
- **Manage Billing:** opens the local ledger (date, description, list price, "not charged").
- **Events:** after a plan or pack change the tab fires `hooklab:credit-status-updated` (the `CREDIT_STATUS_UPDATED` constant in `src/lib/billing/plans.ts`), mirroring the original's `creator-hooks:credit-status-updated`.

## Evidence used

**Static evidence (client bundles, `evidence/scripts-all/files/isolated`):**
- `source-32` has `ProjectsListView`: header, search, status `<select>`, card layout, Create, Edit and Delete modal copy, and `PROJECT_STATUS_OPTIONS` with chip colors.
- `source-17` has the settings components:
  - `SettingsShell` with its hash tabs.
  - The Profile tab: languages list, email preferences, theme, password and delete modals.
  - The Channels tab: style guide defaults `{100, 3, 5}`, the punctuation list, topics rules, Channel Context, Data sources and autosave timings.
  - The Billing components: card logic, toggle defaults, button labels, Best value and Recommended badges, usage card, packs, How credits work, confirm modal.
  - The Teams tab.
  - Prisma enums: `ProjectStatus`, `ProjectAssetKind`, `TeamRole`, and the StyleGuide and ChatPreferences fields.
- `source-11` has `ProjectPickerModal`.
- `source-14` has the trial banner using `/api/user/trial-status` and the resolver calls.
- `source-27` has the getting-started actions and the credit-status event name.

**Runtime evidence:**
- `evidence/screens/{projects,settings,settings-billing}.png`, with their `.txt` and `.outline.json` (classes and computed colors).
- `data/account/*.json`: trial status, channel limit, languages, the channel's profile, style guide and chat preferences, getting-started and announcements.
- Read-only views of the live original's Channels and Teams tabs, which were missing from the capture, saved to `evidence/screens/worker-d/settings-channels.full.png` and `settings-teams.png`. Nothing was edited there.
- Screenshots of the HookLab rebuild for comparison are in `docs/screenshots/projects-settings/`.

**Inferences (no direct evidence):**
- The project detail page. The account had no projects, so its chunk was never loaded and there is no screenshot. Its layout and copy are HookLab's own, built on the original data model (assets, bookmarks, Studio workspaces, chats).
- The credit warning thresholds.
- The team name format ("<owner>'s Team").
- The upgrade messages.
- The getting-started `eligible` flag defaults to the export's `false`.

**Unknowns:**
- Server-side credit accounting.
- How the original schedules downgrades.
- The real-time email preference. The export returned 405, so the seed stores `weeklyIdeas:false`, but the original screenshot shows the box checked. HookLab keeps the stored value.

## Deviations from the original

- **Channels tab:** has a "Your Channels" list with an Active badge, Set active and Remove, as the brief asked. "Add Channel" lives in that card instead of a separate card at the bottom. The original's three-step add wizard (also following competitors and inspiration channels) is reduced to resolving the URL or @handle and adding the channel.
- **Channel changes reload the page:** adding, removing or activating a channel reloads `/settings#channels`. The sidebar loads its channel list once, and this keeps its switcher correct (see the foundation requests below). Pending editor autosaves are flushed first.
- **Manage list / Manage tag:** the gear icons link to `/following` and `/bookmarks` instead of opening those areas' modals.
- **Generate profile / Regenerate:** POST `/api/chat/channel-profile {userChannelId}` (Chat's endpoint). If that route is missing, the button shows a toast.
- **Password, Log Out and Delete Account:** replaced by notes and by "Reset local data". Typing RESET confirms it, and it re-imports the account export.
- **Teams:** invites are local only, with "Mark as joined" standing in for acceptance.
- **Visual details:** page titles use the shared `PageFrame` (26px bold; the original is 24px), and tabs use the shared `Tabs` style.

## Foundation requests

These are files I don't own; none of them blocks the work.

1. **`Sidebar.tsx` channel list:** the sidebar loads `/api/me` once. It should reload it on `CHANNEL_SWITCHED` and on a new `CHANNELS_UPDATED` event; Settings could then drop the reload after channel changes. Its "Add channel" item could link to `/settings?tab=channels&add=1` to open the dialog directly.
2. **`Sidebar.tsx` theme label:** the sidebar keeps its own `theme` state, so after Settings → Appearance switches theme, its "Dark mode / Light mode" label is stale until reload. Reading the `dark` class on `<html>`, or a theme event, would fix it.
3. **`AddToProjectModal.tsx` lint error:** it fails `react-hooks/set-state-in-effect` because it resets state in an effect when opened. Remounting it per open would fix this. Its contract with `/api/projects` is unchanged and works.
4. **`data/pricing.json` and the library `plans` table:** they store Creator and Agency `monthlyPrice` as 14 and 74, the yearly equivalents. The monthly prices are 19 and 99. Billing corrects for this, but other readers would get the wrong price.

## For other areas

- **Chat (B):**
  - Read the credit limit from `/api/user/trial-status` or `settings.credits.monthlyLimit` (packs included), and listen for `hooklab:credit-status-updated`.
  - "New chat in this project" links to `/chat?projectId=<id>`; a chat created there should set `chats.project_id`.
  - `style_guides.content` is JSON.
  - `chat_preferences.listIdsToUse` and `bookmarkTagsToUse` use `null` to mean all.
  - Already working: B files pins as `title` items with `refId = pin id`, and the detail view merges those with `pinned_titles.project_id` without duplicates.
- **Research (A):** POST `/api/getting-started {action:"complete_search"}` after a search to complete that step. `settings.contentLanguages` holds the allowed language codes.
- **Studio (C):** "Open Studio" links to `/studio?projectId=<id>&projectName=<name>` (the original's parameter names), and workspace rows link to `/studio?workspaceId=<id>`. Filing a workspace as a `studio` item and/or setting `studio_workspaces.project_id` both show it once.

## Verification (2026-10-18)

- **Static checks:** `cd app && npx tsc --noEmit` is clean. `npx eslint` on every file listed in this doc is clean. The only lint error under `src/components/projects/` is in the foundation's `AddToProjectModal.tsx`.
- **HTTP status:** `curl` returns 200 for `/projects`, `/projects?status=…`, `/projects/<id>`, `/settings` with `?tab=` values for every tab, and `?tab=channels&add=1`; an unknown project returns 404. Every API above was exercised with curl, including the 400/404/409/501 error paths.
- **Projects end to end, through the UI and API:**
  - Create (modal, then navigates to the new project), inline rename, description edit.
  - Status changes from the header and from the card, and the filter's empty state.
  - Edit details, unlinking the channel.
  - Add and edit notes, add titles, remove a video and a Studio entry.
  - Remove a chat and re-add it with the picker; delete a project.
  - API checks: deduplication, library lookup for a bare video id, bookmark payloads.
- **Settings end to end, through the UI:**
  - Profile: save the name, add and remove a content language, toggle email, switch theme dark and back.
  - Channels:
    - Slider, punctuation, banned words, additional instructions, writing rules, niches, topics, overview, about-my-channel and list instructions; all autosaved, and the DB shapes were checked.
    - List selection gives `[]`, explicit ids, then `null`.
    - Add a channel through A's resolver (`@veritasium`), set it active (the sidebar follows), switch back, remove it.
  - Billing: upgrade to Agency annual, add a 250 pack (limit 7,250 with Chat's real usage counted), view history, switch back to Pro monthly.
  - Teams: invite two people, resend, mark as joined, remove both.
- **Cleanup:** afterward, Samin's profile, languages, email preference, theme, channel profile, style guide, chat preferences and credit state were restored from a snapshot, and the QA ledger rows were deleted.
- **Tested on DB copies:** the Danger Zone reset and the period rollover (packs expire, month-end anchoring) were run against `VACUUM INTO` copies of `app.db`, never the shared DB. The code loaded through Node type-stripping with a path-alias loader.
- **Browser console:** no errors or warnings on any of these pages.
