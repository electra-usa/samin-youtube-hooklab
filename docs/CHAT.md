# Chat (HookLab) — architecture, protocol, setup

Chat is HookLab's headline feature: a YouTube title / thumbnail-text / strategy assistant that answers from the creator's channel data and the outlier library, streaming angle cards title by title like the original Creator Hooks chat.

Evidence labels used below: **[static]** = read in the original's client bundles (`evidence/scripts-all`, REA bundle analysis), **[runtime]** = seen in the recorded browser scenario (`evidence/scenario-chat-titles.json`, `evidence/chat-stream-*.txt`, screenshots), **[inference]** = our reconstruction where the original's server is not observable, **[HookLab]** = deliberate additions.

## 1. Pieces

| Area | Files |
|---|---|
| Pages | `app/src/app/chat/page.tsx` (new chat), `app/src/app/chat/[id]/page.tsx` (thread), `app/src/app/chats/page.tsx` (View all) |
| UI | `app/src/components/chat/*` — `NewChatView`, `ChatThreadView`, `ChatHeader`, `ChatComposer`, `AttachmentDialogs`, `Message` (bubbles, actions, feedback), `AngleCards` (cards, title rows, thumbnail text), `Markdown` (safe renderer with `vref:`/`cref:` links), `VideoRefTooltip`, `PinnedTitlesPanel`, `ChatsList`, hooks `useChatThread`, `useChatAttachments`, API client `client.ts` |
| AI providers | `app/src/lib/ai/` — `config.ts` (provider/model selection), `anthropic.ts` (SDK), `claude-code.ts` (CLI), `credits.ts` (usage → credits), `index.ts` (`generate()`) |
| Pipeline | `app/src/lib/chat/` — `pipeline.ts` (stages + SSE), `router.ts`, `context.ts`, `research.ts`, `grounding.ts`, `prompts.ts`, `schemas.ts`, `json-stream.ts` (incremental JSON parser), `store.ts` (DB), `generations.ts` (cancel registry), `youtube.ts` (yt-dlp transcripts/comments), `attachments.ts`, `pills.ts`, `types.ts`/`constants.ts`/`format.ts` (client-safe) |
| API | `app/src/app/api/chat/**` (table in §5) |

Flow of one reply:

```
/chat  ──POST /api/chat {createOnly}──►  chat + first user message (canned pills also save the canned reply: no model call)
  └─► /chat/<id>  (thread page sees a user message without a reply and streams it)
        POST /api/chat/stream ──► _preparing → _routing (router call, effort low) → _loading_context
                                  → _deep_research (FTS5 over videos_fts) → _generating (main call, effort medium)
                                  → title / card / text_delta events … → done (canonical) → saved to chat_messages
```

## 2. Claude providers

`HOOKLAB_AI_PROVIDER` (in `app/.env.local`): `anthropic`, `claude-code`, or `auto` (default). **auto** uses the SDK when credentials exist (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, workload-identity env, or an `ant auth login` profile under `~/.config/anthropic`), otherwise the Claude Code CLI if it's installed, otherwise every reply is a clear error message in the chat explaining both options. `GET /api/chat/provider` reports what will be used.

Model: `claude-opus-5-5` (override `HOOKLAB_MODEL`). Opus 5.5 always thinks (adaptive); depth is set with `output_config.effort` — `low` for routing and channel profiles, `medium` for answers. No `temperature`, prefill or forced tool choice.

**Add an API key** — create `app/.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
# optional
HOOKLAB_AI_PROVIDER=anthropic
HOOKLAB_MODEL=claude-opus-5-5
```

Next dev reloads `.env.local` automatically.

**SDK provider** (`anthropic.ts`): `new Anthropic()` → `client.beta.messages.stream({ model, max_tokens, thinking: {type:"adaptive"}, output_config: {effort, format: betaZodOutputFormat(schema)}, system: [{…, cache_control}], betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })`. Structured JSON streams as text deltas into the incremental parser; `stream.finalMessage()` gives usage and `stop_reason`. `stop_reason === "refusal"` (the whole fallback chain declined) becomes a friendly message. Errors are mapped with typed classes (`AuthenticationError`, `RateLimitError`, `APIConnectionError`, `APIError` incl. 529 overloaded, `APIUserAbortError`).

**Claude Code CLI provider** (`claude-code.ts`): runs the locally signed-in CLI (`~/.local/bin/claude`, override `HOOKLAB_CLAUDE_CLI`) once per request from a fresh empty temp directory:

```
claude -p --output-format stream-json --verbose --include-partial-messages \
  --model <model> --effort <low|medium> --system-prompt <prompt> --tools "" \
  --strict-mcp-config --safe-mode --disable-slash-commands --no-session-persistence \
  --max-budget-usd 3 [--json-schema <schema>]          # prompt on stdin
```

No tools, no MCP servers, no plugins/hooks/CLAUDE.md (`--safe-mode`), nothing saved to disk. Structured output arrives as the input of the CLI's `StructuredOutput` tool (`input_json_delta` events) and the validated object in the final `result.structured_output`. Variables that tie a child CLI to a parent Claude Code session (`CLAUDECODE`, `CLAUDE_CODE_*` session/socket vars, `CLAUDE_EFFORT`, …) are stripped; `CLAUDE_CONFIG_DIR` passes through (override with `HOOKLAB_CLAUDE_CONFIG_DIR`). Other knobs: `HOOKLAB_CLI_TIMEOUT_MS` (default 6 min), `HOOKLAB_CLI_MAX_BUDGET_USD` (default 3). Earlier turns are sent as a `<conversation_so_far>` transcript because the CLI takes one prompt.

Measured on this Mac: router ≈ 4 s, first title ≈ 20 s, full 5-angle answer ≈ 40–50 s, 9 credits.

## 3. Pipeline

**Routing** (`router.ts`, one low-effort structured call): `{intent, topic, searchQueries[3-6], focusAngle, chatTitle}`. Intents: `titles, more_titles, thumbnail, compare_titles, video_ideas, channels_to_study, whats_working, outline, intro, description, latest_video_analysis, audience_psychology, channel_strategy, general`. The router sees the last messages and which prompt pill started them, so "Generate titles" → *What is your video about?* → description routes to `titles`. `chatTitle` is asked for only while the chat still has its automatic title, and renames the chat once there is a real request to name it after (not on the ask-topic reply) ([runtime]: the original renamed "Untitled" to "Reverse Engineering a YouTube Title Tool" after the first answer). If the router call fails for a non-configuration reason, a keyword heuristic takes over. Titles/outline/intro with no topic and no attachment get *"Let's do it! What is your video about?"* without a generation call.

**Loading context** (`context.ts`): active channel (chat's `user_channel_id`, else `activeChannel()`), `channel_profiles` (overview, primary niches, topics), `style_guides` (JSON fields or free text, "follow strictly"), `chat_preferences` (additional instructions, per-list instructions, lists to use), following lists with their channels, the channel's 20 most recent and 12 most-viewed long-form `channel_videos` with their multipliers, average views, chat attachments, chat history. Latest-video analysis also pulls up to 40 top comments with yt-dlp.

**Deep research** (`research.ts`): every search query runs as quoted-term FTS5 `MATCH` against `videos_fts` (bm25, title weighted 3x); thin results get an OR pass. Matches are deduped and ranked by `2·relevance + 0.6·log2(1+outlier) + recency + niche fit`, keeping 2x+/3K+ performers when there are enough; the top 40 (25 for non-title intents) go to the model as `[V#] videoId=… | "title" | channel (subs) | views | 7.1x | date | triggers | format`. Stats rows `[S#]`: match counts, top click triggers and formats among the matching 2x+ outliers, and the strongest triggers in the creator's niches over 6 months. Broad intents add the top recent outliers in the creator's niches (`N#`, respecting the excluded-niche defaults), followed channels' recent outliers (`F#`), and for "who should I study" two channel candidate lists (`C#`, in-niche and outside, excluding followed channels).

**Generation**: titles, thumbnail text, "More titles" and markdown answers are all structured outputs (`schemas.ts`), parsed incrementally (`json-stream.ts`) so events go out as soon as each title, card, thumbnail text or markdown fragment is complete.

**Grounding** (`grounding.ts`) — nothing numeric is invented:
- Each title names a `skeletonVideoId` (+ optional `secondaryVideoId`) from the research list; ids are checked against real library rows. `derivation` = `skeleton:<videoId>, <slot notes>`, `inspirationSources` = those rows' `{title, channelName}`, and they're added to `videoMap`. Unknown ids are dropped.
- `clickTrigger` keeps only names from the 48 click triggers (max 2, joined with " + "), falling back to the skeleton video's own triggers.
- The recommendation reason cites `{{video:ID}}` / `{{stat:S#}}` placeholders that the server replaces with `"Title" at 83.3K views (5.1x)` and the stat clause. Exactly one card ends up recommended.
- Markdown answers link videos as `[title](vref:ID)` and channels as `[name](cref:ID)`; links to ids that aren't real library/channel rows are unlinked.

**Persistence**: user and assistant messages in `chat_messages` (`content`, `cards_json` = `MessageCards`, `metadata_json` = intent/topic/searchQueries/videoMap/provider/model/credits/generationId/cancelled/error, `attachments_json`, `prompt_pill_json`, `feedback`). Attachments in `chat_attachments`. One row per stream in `chat_generations` (created by this module: id, chat_id, assistant_message_id, target_message_id, kind message|expansion, status running|cancel_requested|completed|cancelled|failed, cancel_reason, provider, model, timestamps). Errors are saved as an assistant message too, so a failed reply never re-triggers itself on reload.

**Stop / background**: "Stop generating" → `POST /api/chat/generations/cancel {generationId}` aborts the model call (SDK abort signal / CLI SIGTERM) through a process-wide registry (`globalThis`, plus a DB status poll); the pipeline saves what was already streamed (finished cards, the card in progress, markdown so far) with `metadata.cancelled` and ends with `done` + `cancelled: true`. Closing or reloading the tab does *not* stop a reply: it keeps running and is saved; the thread shows "Still writing this answer…" (from `activeGeneration`) and polls until it lands. Rows left `running` by a server restart are closed out when the chat is next opened.

## 4. SSE protocol (`POST /api/chat/stream`)

Request [runtime]: `{chatId, message, assistantMessageId, generationId}`. Warmup [runtime]: `{warmup: true, channelId}` → JSON `{"version":"1.0","ok":true}` (opens the library DB, no model call).
Request additions [HookLab]: `userMessageId` (client id for the user message saved by this call), `expand: {messageId, cardId}` ("More titles →" for one angle card).

The user message: if the chat's last message is a user message with the same text (created by `/api/chat`), it is reused; otherwise it is inserted. 409 if the chat already has a reply in progress.

Response: `text/event-stream`, one `data: <json>\n\n` per event, every event has `"version":"1.0"`. `: ping` comment lines every 10 s keep the connection open during long thinking [HookLab]; clients ignore lines that don't start with `data:`.

| Event | Shape | Source |
|---|---|---|
| progress | `{"tool_status":"executing","tool_name":"_preparing"\|"_routing"\|"_loading_context"\|"_deep_research"\|"_generating"}` | [runtime] |
| progress intent | `_generating` also carries `"intent":"titles"…` so the UI can say "Writing titles…" | [HookLab] |
| title | `{"title":{id,title,angle,angleEmoji,clickTrigger,derivation,inspirationSources[{title,channelName}]}}` — ids `title_<angle>_<n>`; expansion ids `title_<angle>_m<batch>_<n>` | [runtime] (inspirationSources are filled immediately here; the original sent `[]` until `done`) |
| card | `{"card":{id:"angle_<n>",name,emoji,description,titles[],isRecommended,recommendationReason?}}` after each angle's titles | [runtime] |
| thumbnail_text | `{"thumbnail_text":{id,text,inspirationSources?}}` | [HookLab] |
| text_delta | `{"text_delta":"..."}` markdown fragments for non-title intents | [HookLab] |
| chat_title | `{"chat_title":"..."}` when the chat is auto-named | [HookLab] |
| error | `{"error":"friendly message","code":"no_provider\|auth\|rate_limit\|overloaded\|refusal\|timeout\|bad_output\|api\|internal"}` followed by `done` with `canonical: null` | [HookLab] |
| done | `{"done":true,"messageId","canonical",metadata,videoMap,"credits"?, "cancelled"?}` | [runtime] + additions |

`canonical` types:
- `{"version":"1.0","type":"cards","payload":{"angleCards":[…],"bodyMarkdown"},"summary","suggestedFollowups":[…]}` — titles [runtime]; thumbnail answers use the same type with `payload.thumbnailTexts` [HookLab].
- `{"version":"1.0","type":"markdown","payload":{"markdown"},"suggestedFollowups":[…]}` [HookLab].
- `{"version":"1.0","type":"titles","payload":{"messageId","cardId","batch":{batchIndex,generationId,titles,createdAt}}}` — "More titles" [HookLab; the original appended batches through hidden messages, see [static] `cardExpansions`].

`metadata` mirrors the original (`summary, intro, bodyMarkdown, angleCards, suggestedFollowups`) plus `intent, provider, model`. `videoMap` keys are lowercased titles → `{title, views:"83.3K", outlierScore:"5.1x", channelName, videoId, publishedAt}` [runtime].

## 5. REST API (`app/src/app/api/chat/`)

| Route | Behavior |
|---|---|
| `POST /api/chat` | `{message, channelId?, createOnly?, assistantMessage?, assistantCards?, attachments?, promptPill?, projectId?}` → `{success, data:{chatId, attachments}}`. Title = first 50 chars of the message. `assistantMessage` (canned pill) is saved as the reply, no model call. `channelId` may be a `user_channels.id` or YouTube channel id. |
| `GET /api/chat/[id]` | `{chat:{id,title,projectId,projectName,channelId,channelName,channelAvatar,…}, messages, attachments, activeGeneration}` |
| `PATCH /api/chat/[id]` | `{title?}` rename, `{projectId?}` link/unlink a project (validated against `projects`) |
| `DELETE /api/chat/[id]` | Chat, messages, attachments, generations, feedback, pins (+ their `project_items`), and its `project_items` kind "chat" |
| `POST /api/chat/stream` | SSE above |
| `POST /api/chat/generations/cancel` | `{generationId}` → `{success, status}`; 404 if unknown |
| `POST /api/chat/prewarm` | Opens both databases → `{ok:true}` |
| `POST /api/chat/feedback` | `{chatMessageId, chatId, rating:"positive"\|"negative", reason?, comment?, title?}`. Every rating is a `title_feedback` row (`title` "" = whole reply); reply-level ratings also set `chat_messages.feedback`. Reasons = `TITLE_FEEDBACK_REASONS`. |
| `GET /api/chat/usage-limit` | `{allowed:true, plan, creditLimit, usedCredits, creditsRemaining, periodStartsAt, periodEndsAt}` |
| `GET /api/chat/provider` | provider status (setting, provider, model, error, credentials found, CLI path) [HookLab] |
| `GET/POST /api/chat/channel-profile` | GET: stored profile + style guide for the header popover. POST `{userChannelId}`: regenerates the overview + primary niches from the channel's last 50 videos (low effort) and stores it in `channel_profiles` (Settings' "Generate profile") |
| `GET /api/chat/channel-cards?ids=` | `{data:[{channelId, channelName, subscriberCount, videoCount, recentVideos: VideoRef[]}]}` for `cref:` hover cards |
| `GET/POST/DELETE /api/chat/pins` | GET `?chatId=`; POST `{chatId, messageId, title, angle?, clickTrigger?, cardKey?}` → `{pin, projectItemId}` (also a `project_items` row kind "title", `ref_id` = pin id, when the chat belongs to a project); DELETE `?id=` removes both |
| `POST /api/chat/attachments` | `{chatId, attachment}` → `{attachment}` (240K-character total budget per chat). `GET ?chatId=` lists. |
| `PATCH/DELETE /api/chat/attachments/[id]` | rename label / remove |
| `POST /api/chat/attachments/prepare-transcript` | `{sourceType:"youtube_url"\|"pasted", value}` → `{attachment}` draft. URLs use `/opt/homebrew/bin/yt-dlp` (`HOOKLAB_YTDLP`, extra flags in `HOOKLAB_YTDLP_ARGS`) to fetch captions (`en`, `en-orig`, any `*-orig`), parsed to plain text with rolling-caption duplicates removed. Pasted: 50–200,000 chars. |
| `POST /api/chat/attachments/prepare-upload-text` | multipart `file`: TXT/MD/SRT/VTT up to 2 MB → `{attachment}`; PDFs 415 |
| `POST /api/chat/attachments/prepare-screenshot` | 415 — images not supported yet |

Shared, not owned here: `GET /api/chats` (sidebar list, foundation). After creating/renaming/deleting a chat the client calls `notifyChatsUpdated()`.

## 6. Credits

1 credit = $0.02 of model usage at list prices, rounded up, minimum 1 per reply:
`usd = (input·in + cacheWrite·in·1.25 + cacheRead·in·0.1 + output·out) / 1e6`, `credits = max(1, ceil(usd / 0.02))`, with per-model prices (Opus 5.5: in $4, out $20 per MTok). When the CLI reports its own `total_cost_usd` (list price, includes its small side calls) that figure is used. Router + generation are one `credit_usage` row per reply (`chat_id, message_id, credits, input_tokens` incl. cache, `output_tokens, model`); a "More titles" batch is charged to the message it expands; a stopped call is estimated at ~4 characters per token. Observed: 9 credits for a 5-angle title answer, 5 for a "More titles" batch (the original account showed 10 used credits after its title session [runtime]). `creditStatus()` sums the current monthly period from `settings.credits`.

## 7. Prompts (`lib/chat/prompts.ts`)

Fixed system prompts (cache-friendly); per-request data goes in the last user turn as tagged sections: `<creator_channel>`, `<creator_preferences>`, `<followed_channels>`, `<attachments>`, `<research>`, `<latest_video>`, `<task>`, `<request>`.

- `ROUTER_SYSTEM` — intent list, topic, search-query expansion, chat title.
- `TITLES_SYSTEM` — 5 distinct angles × 2 titles, each adapting one research skeleton (structure kept, slots filled with the creator's topic, never copied); 1–2 triggers from the 48; one recommended angle whose reason cites placeholders only; style guide obeyed; summary, closing question, 3 follow-ups.
- `MORE_TITLES_SYSTEM` — N new titles for one angle, different skeletons/wording from the ones already written.
- `THUMBNAIL_SYSTEM` — 6 overlay texts (2–5 words) that complement the title, plus a visual concept and the best pairing.
- `MARKDOWN_SYSTEM` + `INTENT_GUIDANCE` — grounded answers: only numbers from the context, `vref:`/`cref:` links, answer first, ~450 words; per-intent task notes (compare titles, ideas, channels to study, what's working, outline, intro, description, latest video, audience psychology, channel strategy, general).
- `PROFILE_SYSTEM` — channel overview + 1–3 niches from the 45.

## 8. UI notes and deviations

- New chat [static/runtime]: "Hello {first name}, let's work on your next video!" (the original used the session name, falling back to "there"), composer "Ask HookLab to...", pills = "Generate titles" + 3 others (capabilities pill pinned while the user has no chats, the others random — picked server-side per request). Pills hide while typing. Canned pills (Generate titles, Show me what this chat can do, Brainstorm ideas, Outline / Write an intro) create the chat with the canned reply and no model call; with an attachment present they call the model instead [static]. `/chat?prompt=…` fills and sends once (`&send=0` only fills); the original only pre-filled [static].
- Thread [runtime]: right-aligned gray user bubbles, angle cards (blue panel + "Recommended" chip + reason box on the recommended card), "More titles →" batches with skeleton rows, closing question, follow-up pills (last reply only), copy / thumbs up / thumbs down with the reasons form. Header: channel avatar (popover with profile + style-guide status, link to Settings), editable title, "Add to project" (`AddToProjectModal`, kind "chat"; on success the chat's `project_id` is set and the header shows the project).
- Title row icons [static]: the original has **Generate thumbnail text** (image icon), **Inspiration source** (lightbulb → hover card of the skeleton video), **Pin**. HookLab keeps those and adds **Preview in Studio** (monitor icon → `/studio?prefillTitle=…`) [HookLab]. The brief described the lightbulb as "thumbnail ideas"; the bundle shows it is the inspiration tooltip, so the thumbnail request lives on the image icon (sends `Generate thumbnail text for this title: "<title>"`).
- Pinned titles drawer [runtime: the "Show pinned titles" tab; contents inferred]: pins of this chat with Preview in Studio and Unpin; the thread narrows while it's open.
- Stop generating [static: `ChatInput` stop button; runtime: endpoint seen by REA]: square button replaces Send while a reply streams.

## 9. Limits and known gaps

- Screenshots/images as chat context aren't supported (415); PDFs aren't parsed (415). TXT/MD/SRT/VTT and transcripts are.
- yt-dlp can be rate-limited by YouTube (HTTP 429); the error says so and suggests pasting. Comments for latest-video analysis are best effort.
- Followed channels only contribute videos that exist in the outlier library (`channelOutliers`); `followed_videos` sync data isn't used yet.
- The CLI provider reports usage only for completed calls; stopped calls are estimated. Images can't be passed to it, and each request starts a fresh CLI process (~1–2 s overhead).
- `activeGeneration` relies on this server process; after a restart an interrupted reply is closed out and the pending message can simply be re-sent (the thread auto-sends a trailing unanswered user message once).
- One reply per chat at a time (409 otherwise). The usage limit never blocks (`allowed: true`).
- `/chat/[id]` for a missing chat renders a "doesn't exist anymore" state with HTTP 200 (client-rendered).

## 10. Verification (2026-10-18)

- `npx tsc --noEmit` and `npx eslint` clean on all chat files.
- Live generations through the claude-code provider (5 total): SSE via a script client (`_preparing`→`_generating`, first title at 22.7 s, 10 titles + 5 cards, `done` at 38.5 s, 9 credits; all derivations/inspiration sources resolved to real library rows, videoMap of 10 real videos); browser title generation from the "Generate titles" pill; "More titles →" (4 titles appended and persisted, 5 credits); a "what's working" markdown answer stopped mid-stream (partial kept and persisted, generation `cancelled`); thumbnail text from the image icon.
- `curl -N` on a typed "Generate titles" (router call only): `_preparing`/`_routing` at 0.01 s, `done` with the ask-topic reply at 6.2 s, events flushed one by one.
- Canned pills: chat + canned reply created with no `chat_generations` / `credit_usage` rows.
- Reload: threads reload from the DB (cards, expansions, videoMap hover cards, stopped replies, feedback state); no duplicate generation on reload.
- Pins (incl. `project_items` when the chat is in a project), feedback (`title_feedback` + `chat_messages.feedback`), rename/search/delete on `/chats`, transcript from URL (21K chars via yt-dlp in ~7 s), pasted transcript, VTT upload, PDF rejection, attachment add/remove.
- Screenshots: `docs/screenshots/chat/`.
