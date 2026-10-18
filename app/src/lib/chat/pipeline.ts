import "server-only";
import { AiError, generate, type AiRequest, type AiResult, type AiTurn, type AiUsage } from "@/lib/ai";
import { aiModel, resolveProvider } from "@/lib/ai/config";
import { addUsage, recordUsage, ZERO_USAGE } from "@/lib/ai/credits";
import { MORE_TITLES_BATCH } from "./constants";
import { historyTurns, loadContext, renderChannelContext, type ChatContext } from "./context";
import { cancelRequested, registerGeneration, unregisterGeneration } from "./generations";
import { buildTitle, Evidence } from "./grounding";
import { JsonStreamParser } from "./json-stream";
import { INTENT_GUIDANCE, MARKDOWN_SYSTEM, MORE_TITLES_SYSTEM, THUMBNAIL_SYSTEM, TITLES_SYSTEM } from "./prompts";
import {
  channelCandidates,
  channelOutliers,
  lookupVideos,
  nicheOutliers,
  renderStats,
  renderVideos,
  researchTopic,
  type ChannelCandidate,
  type Research,
  type ResearchVideo,
} from "./research";
import { routeMessage, type Route } from "./router";
import {
  MarkdownSchema,
  MoreTitlesSchema,
  ThumbnailSchema,
  TitlesSchema,
  type GeneratedTitleOutput,
  type MarkdownOutput,
  type MoreTitlesOutput,
  type ThumbnailOutput,
  type TitlesOutput,
} from "./schemas";
import {
  getChatRow,
  getMessage,
  hasAutoTitle,
  insertGeneration,
  insertMessage,
  renameChat,
  setGenerationStatus,
  updateMessageCards,
  updateMessageMeta,
} from "./store";
import {
  SSE_VERSION,
  type AngleCard,
  type Canonical,
  type CardExpansionBatch,
  type ChatTitle,
  type Intent,
  type MessageCards,
  type MessageMeta,
  type StageName,
  type ThumbnailText,
} from "./types";
import { fetchComments, type VideoComment } from "./youtube";

// The /api/chat/stream pipeline: _preparing → _routing → _loading_context → _deep_research →
// _generating, emitting SSE events as titles, cards and text arrive, then persisting the reply.

export type StreamInput = {
  chatId: string;
  message: string;
  userMessageId: string | null;
  assistantMessageId: string;
  generationId: string;
  expand: { messageId: string; cardId: string } | null;
};

type Send = (event: Record<string, unknown>) => void;

type Reply = {
  content: string;
  cards: MessageCards | null;
  canonical: Canonical;
};

type State = {
  intent: Intent | null;
  route: Route | null;
  usage: AiUsage;
  model: string;
  provider: string | null;
  evidence: Evidence;
  summary: string;
  heads: Map<number, { name?: string; emoji?: string; description?: string }>;
  pendingTitles: Map<number, ChatTitle[]>;
  cards: AngleCard[];
  markdown: string;
  thumbnailTexts: ThumbnailText[];
  expansionTitles: ChatTitle[];
};

const CANNED_ASK_TOPIC = "Love it. What's the video about? Give me the topic, who it's for, and anything that makes your take different.";

export function createGenerationStream(input: StreamInput): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let closed = false;
  let ping: ReturnType<typeof setInterval> | null = null;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };
      const send: Send = (event) => write(`data: ${JSON.stringify({ version: SSE_VERSION, ...event })}\n\n`);
      // Comment lines keep the connection alive through long thinking phases.
      ping = setInterval(() => write(": ping\n\n"), 10_000);
      runPipeline(input, send).finally(() => {
        if (ping) clearInterval(ping);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      });
    },
    cancel() {
      // The client went away (navigation, reload). The generation keeps running and is saved,
      // so the thread shows it when reopened. "Stop generating" uses the cancel endpoint instead.
      closed = true;
      if (ping) clearInterval(ping);
    },
  });
}

const stage = (name: StageName, intent?: Intent) => ({ tool_status: "executing", tool_name: name, ...(intent ? { intent } : {}) });

async function runPipeline(input: StreamInput, rawSend: Send) {
  const resolved = resolveProvider();
  const controller = registerGeneration(input.generationId, input.chatId);
  const signal = controller.signal;
  insertGeneration({
    id: input.generationId,
    chatId: input.chatId,
    assistantMessageId: input.assistantMessageId,
    targetMessageId: input.expand?.messageId ?? input.userMessageId,
    kind: input.expand ? "expansion" : "message",
    provider: resolved.ok ? resolved.provider : null,
    model: resolved.ok ? resolved.model : null,
  });

  // Poll the database for cancels that arrive through another route instance.
  let lastCheck = Date.now();
  const send: Send = (event) => {
    rawSend(event);
    if (Date.now() - lastCheck > 750) {
      lastCheck = Date.now();
      if (!signal.aborted && cancelRequested(input.generationId)) controller.abort("user_cancelled");
    }
  };

  const state: State = {
    intent: input.expand ? "more_titles" : null,
    route: null,
    usage: ZERO_USAGE,
    model: resolved.ok ? resolved.model : aiModel(),
    provider: resolved.ok ? resolved.provider : null,
    evidence: new Evidence(),
    summary: "",
    heads: new Map(),
    pendingTitles: new Map(),
    cards: [],
    markdown: "",
    thumbnailTexts: [],
    expansionTitles: [],
  };

  let status: "completed" | "cancelled" | "failed" = "completed";
  try {
    send(stage("_preparing"));
    if (!resolved.ok) throw new AiError("no_provider", resolved.error);
    if (input.expand) await runExpansion(input, state, send, signal);
    else await runMessage(input, state, send, signal);
  } catch (err) {
    const aborted = signal.aborted || (err instanceof AiError && err.code === "aborted");
    if (aborted) {
      status = "cancelled";
      finishCancelled(input, state, send);
    } else {
      status = "failed";
      const message = err instanceof AiError ? err.message : "Something went wrong while writing this answer. Please try again.";
      const code = err instanceof AiError ? err.code : "internal";
      if (!(err instanceof AiError)) console.error("[chat] pipeline error", err);
      send({ error: message, code });
      if (input.expand) {
        chargeUsage(input, state, input.expand.messageId);
      } else {
        const credits = chargeUsage(input, state, input.assistantMessageId);
        insertMessage({
          id: input.assistantMessageId,
          chatId: input.chatId,
          role: "assistant",
          content: message,
          metadata: { ...baseMeta(input, state, credits), error: message, errorCode: code },
        });
      }
      send({ done: true, messageId: input.assistantMessageId, canonical: null, metadata: { error: message, code }, videoMap: {} });
    }
  } finally {
    unregisterGeneration(input.generationId);
    setGenerationStatus(input.generationId, status);
  }
}

function baseMeta(input: StreamInput, state: State, credits: number | undefined): MessageMeta {
  return {
    ...(state.intent ? { intent: state.intent } : {}),
    ...(state.route?.topic ? { topic: state.route.topic } : {}),
    ...(state.route?.searchQueries?.length ? { searchQueries: state.route.searchQueries } : {}),
    videoMap: state.evidence.videoMap,
    ...(state.provider ? { provider: state.provider } : {}),
    model: state.model,
    ...(credits != null ? { credits } : {}),
    generationId: input.generationId,
  };
}

function chargeUsage(input: StreamInput, state: State, messageId: string): number | undefined {
  const u = state.usage;
  if (!u.inputTokens && !u.outputTokens && !u.cacheReadTokens && !u.cacheCreationTokens && !u.costUsd) return undefined;
  return recordUsage({ chatId: input.chatId, messageId, usage: u, model: state.model });
}

// ------------------------------------------------------------------ normal messages

async function runMessage(input: StreamInput, state: State, send: Send, signal: AbortSignal) {
  const chat = getChatRow(input.chatId);
  if (!chat) throw new AiError("api", "This chat no longer exists.");

  send(stage("_routing"));
  const ctx = loadContext(input.chatId, chat.user_channel_id);
  const history = ctx.history.filter((m) => m.id !== input.userMessageId);
  const needTitle = hasAutoTitle(input.chatId);
  const route = await routeMessage({ message: input.message, history, ctx, needTitle, signal });
  state.route = route;
  state.intent = route.intent;
  if (route.usage) state.usage = addUsage(state.usage, route.usage);
  if (route.model) state.model = route.model;
  // Titles, outlines and intros need to know what the video is about first.
  const needsTopic = route.intent === "titles" || route.intent === "outline" || route.intent === "intro";
  const askTopic = needsTopic && !route.topic.trim() && !ctx.attachments.length;
  // Name the chat once there's something to name it after (like the original's rename after the first real answer).
  if (needTitle && !askTopic && route.chatTitle.trim()) {
    const title = route.chatTitle.trim().replace(/^["']|["'.]$/g, "").slice(0, 80);
    renameChat(input.chatId, title);
    send({ chat_title: title });
  }
  if (signal.aborted) throw new AiError("aborted", "Stopped.");

  if (askTopic) {
    finishReply(input, state, send, {
      content: CANNED_ASK_TOPIC,
      cards: null,
      canonical: { version: SSE_VERSION, type: "markdown", payload: { markdown: CANNED_ASK_TOPIC }, suggestedFollowups: [] },
    });
    return;
  }

  send(stage("_loading_context"));
  const followedIds = [...new Set(ctx.followingLists.flatMap((l) => l.channels.map((c) => c.channelId)))];
  let comments: VideoComment[] | null = null;
  if (route.intent === "latest_video_analysis" && ctx.recentVideos[0]) {
    comments = await fetchComments(ctx.recentVideos[0].videoId, 40);
  }
  state.evidence.addChannelVideos([...ctx.recentVideos, ...ctx.topVideos]);
  if (signal.aborted) throw new AiError("aborted", "Stopped.");

  send(stage("_deep_research"));
  const research = gatherResearch(route, ctx, followedIds);
  state.evidence.addVideos([...research.topic.videos, ...research.followed, ...research.niche]);
  state.evidence.addStats(research.topic.stats);
  // Videos cited in the previous reply stay citable.
  const lastReply = [...history].reverse().find((m) => m.role === "assistant");
  state.evidence.hydrate(Object.values(lastReply?.metadata?.videoMap ?? {}).map((v) => v.videoId));
  if (signal.aborted) throw new AiError("aborted", "Stopped.");

  send(stage("_generating", route.intent));
  const turns = historyTurns(history);
  let reply: Reply;
  if (route.intent === "titles" || route.intent === "more_titles") {
    reply = await generateTitles({ input, state, send, signal, ctx, route, research, turns });
  } else if (route.intent === "thumbnail") {
    reply = await generateThumbnails({ input, state, send, signal, ctx, route, research, turns });
  } else {
    reply = await generateMarkdown({ input, state, send, signal, ctx, route, research, turns, comments });
  }
  finishReply(input, state, send, reply);
}

type GatheredResearch = { topic: Research; followed: ResearchVideo[]; niche: ResearchVideo[]; candidates: { inNiche: ChannelCandidate[]; outside: ChannelCandidate[] } | null };

function gatherResearch(route: Route, ctx: ChatContext, followedIds: string[]): GatheredResearch {
  const queries = route.searchQueries.length ? route.searchQueries : ctx.primaryNiches;
  const topicLimit = route.intent === "titles" || route.intent === "more_titles" || route.intent === "thumbnail" ? 40 : 25;
  const topic = researchTopic({ queries, niches: ctx.primaryNiches, limit: topicLimit });
  const followed = channelOutliers(followedIds, 12).map((v, i) => ({ ...v, ref: `F${i + 1}` }));
  const broad = ["video_ideas", "whats_working", "channel_strategy", "audience_psychology", "channels_to_study", "latest_video_analysis", "general"];
  const niche = broad.includes(route.intent)
    ? nicheOutliers({
        niches: ctx.primaryNiches,
        days: route.intent === "whats_working" ? 30 : 90,
        limit: 30,
        excludedNiches: ctx.excludedNiches,
        excludeChannelId: ctx.channel?.channelId ?? null,
      }).map((v, i) => ({ ...v, ref: `N${i + 1}` }))
    : [];
  const candidates =
    route.intent === "channels_to_study"
      ? {
          inNiche: channelCandidates({ niches: ctx.primaryNiches, excludeChannelIds: [...followedIds, ctx.channel?.channelId ?? ""], limit: 12, inNiche: true }),
          outside: channelCandidates({ niches: ctx.primaryNiches, excludeChannelIds: [...followedIds, ctx.channel?.channelId ?? ""], limit: 12, inNiche: false }),
        }
      : null;
  return { topic, followed, niche, candidates };
}

function researchSection(r: GatheredResearch): string {
  const parts: string[] = ["<research>"];
  if (r.topic.videos.length) {
    parts.push(`Library search queries: ${r.topic.queries.join("; ")}`);
    parts.push(`Outlier videos matching the topic (best matches first):\n${renderVideos(r.topic.videos)}`);
  } else {
    parts.push("No library videos matched the topic search.");
  }
  if (r.niche.length) parts.push(`Top recent outliers in the creator's niches:\n${renderVideos(r.niche)}`);
  if (r.followed.length) parts.push(`Recent outliers from channels the creator follows:\n${renderVideos(r.followed)}`);
  if (r.topic.stats.length) parts.push(`Library stats:\n${renderStats(r.topic.stats)}`);
  if (r.candidates) {
    const render = (list: ChannelCandidate[]) =>
      list
        .map(
          (c) =>
            `[${c.ref}] channelId=${c.channelId} | ${c.channelName}${c.subscriberCount ? ` (${Math.round(c.subscriberCount / 1000)}K subs)` : ""} | ${c.outliers} recent 3x+ outliers, median ${c.medianOutlier.toFixed(1)}x | best: "${c.bestTitle}" (videoId=${c.bestVideoId}, ${c.bestOutlier.toFixed(1)}x) | niches: ${c.niches.join(", ")}`,
        )
        .join("\n");
    parts.push(`Channel candidates in the creator's niche:\n${render(r.candidates.inNiche) || "(none)"}`);
    parts.push(`Channel candidates outside the niche:\n${render(r.candidates.outside) || "(none)"}`);
  }
  parts.push("</research>");
  return parts.join("\n\n");
}

type GenArgs = {
  input: StreamInput;
  state: State;
  send: Send;
  signal: AbortSignal;
  ctx: ChatContext;
  route: Route;
  research: GatheredResearch;
  turns: AiTurn[];
  comments?: VideoComment[] | null;
};

function userTurn(parts: string[]): string {
  return parts.filter((p) => p && p.trim()).join("\n\n");
}

function buildCard(raw: TitlesOutput["angles"][number], index: number, evidence: Evidence): AngleCard {
  const head = { name: raw.name.trim(), emoji: raw.emoji.trim() || "💡" };
  const titles = raw.titles.map((t, j) => buildTitle(t, `title_${index + 1}_${j + 1}`, head, evidence));
  const reason = raw.recommendationReason?.trim();
  return {
    id: `angle_${index + 1}`,
    name: head.name,
    emoji: head.emoji,
    description: evidence.expandPlaceholders(raw.description.trim()),
    titles,
    isRecommended: !!raw.isRecommended,
    ...(raw.isRecommended && reason ? { recommendationReason: evidence.expandPlaceholders(reason) } : {}),
  };
}

/** Exactly one recommended card, carrying the only recommendation reason. */
function settleRecommendation(cards: AngleCard[]): AngleCard[] {
  const first = cards.findIndex((c) => c.isRecommended);
  const pick = first >= 0 ? first : 0;
  return cards.map((c, i) => {
    if (i === pick) return { ...c, isRecommended: true };
    const rest = { ...c, isRecommended: false };
    delete rest.recommendationReason;
    return rest;
  });
}

const followups = (xs: string[]) => xs.map((s) => s.trim()).filter(Boolean).slice(0, 3);

/**
 * One model call that always counts toward usage: real usage on success, and an estimate
 * (about 4 characters per token) when the call is stopped or fails before reporting usage.
 */
async function callModel(state: State, req: AiRequest): Promise<AiResult> {
  const promptChars = req.system.length + req.messages.reduce((n, m) => n + m.content.length, 0);
  let outputChars = 0;
  const count = <T extends unknown[]>(fn?: (...args: T) => void) =>
    fn
      ? (...args: T) => {
          outputChars += typeof args[0] === "string" ? args[0].length : 0;
          fn(...args);
        }
      : undefined;
  try {
    const result = await generate({ ...req, onJsonDelta: count(req.onJsonDelta), onTextDelta: count(req.onTextDelta) });
    state.usage = addUsage(state.usage, result.usage);
    return result;
  } catch (err) {
    // Only calls that reached the model cost anything (not auth or configuration failures).
    const ran = outputChars > 0 || (err instanceof AiError && ["aborted", "timeout", "bad_output"].includes(err.code));
    if (ran) {
      state.usage = addUsage(state.usage, {
        inputTokens: Math.ceil(promptChars / 4),
        outputTokens: Math.ceil(outputChars / 4),
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      });
    }
    throw err;
  }
}

async function generateTitles(a: GenArgs): Promise<Reply> {
  const { state, send, signal, ctx, route, research, turns, input } = a;
  const reset = () => {
    state.summary = "";
    state.heads.clear();
    state.pendingTitles.clear();
    state.cards = [];
  };
  let parser = makeTitlesParser(state, send);
  const focus = route.intent === "more_titles" || route.focusAngle.trim()
    ? `Focus: the creator wants more titles in the direction of the "${route.focusAngle.trim() || "most recent"}" angle from your earlier answer. Write 1-2 angles that develop that direction with 4-5 fresh titles each, and don't repeat earlier titles.`
    : "";
  const result = await callModel(state, {
    system: TITLES_SYSTEM,
    messages: [
      ...turns,
      {
        role: "user",
        content: userTurn([
          renderChannelContext(ctx, { videos: "brief" }),
          researchSection(research),
          `<request>\nVideo topic: ${route.topic || "(see the creator's message)"}\n${focus}\nCreator's message: ${input.message}\n</request>`,
        ]),
      },
    ],
    effort: "medium",
    maxTokens: 24_000,
    schema: TitlesSchema,
    signal,
    onJsonDelta: (chunk) => parser.write(chunk),
    onJsonReset: () => {
      reset();
      parser = makeTitlesParser(state, send);
    },
  });
  state.model = result.model;

  const out = result.json as TitlesOutput;
  const cards = settleRecommendation(out.angles.map((angle, i) => buildCard(angle, i, state.evidence)));
  const summary = out.summary.trim();
  const body = out.bodyMarkdown.trim();
  const follow = followups(out.suggestedFollowups);
  return {
    content: summary,
    cards: { summary, intro: summary, angleCards: cards, bodyMarkdown: body, suggestedFollowups: follow },
    canonical: { version: SSE_VERSION, type: "cards", payload: { angleCards: cards, bodyMarkdown: body }, summary, suggestedFollowups: follow },
  };
}

function makeTitlesParser(state: State, send: Send): JsonStreamParser {
  return new JsonStreamParser({
    onValue: (path, value) => {
      if (path.length === 1 && path[0] === "summary") {
        state.summary = String(value);
        return;
      }
      if (path[0] !== "angles" || typeof path[1] !== "number") return;
      const ai = path[1];
      if (path.length === 3 && (path[2] === "name" || path[2] === "emoji" || path[2] === "description")) {
        state.heads.set(ai, { ...state.heads.get(ai), [path[2]]: String(value) });
      } else if (path.length === 4 && path[2] === "titles" && typeof path[3] === "number") {
        const head = state.heads.get(ai) ?? null;
        const title = buildTitle(value as GeneratedTitleOutput, `title_${ai + 1}_${path[3] + 1}`, head, state.evidence);
        state.pendingTitles.set(ai, [...(state.pendingTitles.get(ai) ?? []), title]);
        send({ title });
      } else if (path.length === 2) {
        const card = buildCard(value as TitlesOutput["angles"][number], ai, state.evidence);
        state.cards[ai] = card;
        state.pendingTitles.delete(ai);
        send({ card });
      }
    },
  });
}

async function generateThumbnails(a: GenArgs): Promise<Reply> {
  const { state, send, signal, ctx, route, research, turns, input } = a;
  const toText = (raw: ThumbnailOutput["thumbnailTexts"][number], i: number): ThumbnailText => {
    const v = state.evidence.resolve(raw.sourceVideoId);
    return { id: `thumb_${i + 1}`, text: raw.text.trim(), ...(v ? { inspirationSources: [state.evidence.cite(v)] } : {}) };
  };
  const makeParser = () =>
    new JsonStreamParser({
      onValue: (path, value) => {
        if (path.length === 1 && path[0] === "summary") state.summary = String(value);
        if (path.length === 2 && path[0] === "thumbnailTexts" && typeof path[1] === "number") {
          const t = toText(value as ThumbnailOutput["thumbnailTexts"][number], path[1]);
          state.thumbnailTexts[path[1]] = t;
          send({ thumbnail_text: t });
        }
      },
    });
  let parser = makeParser();
  const result = await callModel(state, {
    system: THUMBNAIL_SYSTEM,
    messages: [
      ...turns,
      {
        role: "user",
        content: userTurn([
          renderChannelContext(ctx, { videos: "brief" }),
          researchSection(research),
          `<request>\nVideo topic: ${route.topic || "(see the creator's message)"}\nCreator's message: ${input.message}\n</request>`,
        ]),
      },
    ],
    effort: "medium",
    maxTokens: 16_000,
    schema: ThumbnailSchema,
    signal,
    onJsonDelta: (chunk) => parser.write(chunk),
    onJsonReset: () => {
      state.thumbnailTexts = [];
      parser = makeParser();
    },
  });
  state.model = result.model;
  const out = result.json as ThumbnailOutput;
  const texts = out.thumbnailTexts.map(toText);
  const summary = out.summary.trim();
  const body = state.evidence.groundMarkdown(out.bodyMarkdown.trim());
  const follow = followups(out.suggestedFollowups);
  return {
    content: summary,
    cards: { summary, intro: summary, thumbnailTexts: texts, bodyMarkdown: body, suggestedFollowups: follow },
    canonical: { version: SSE_VERSION, type: "cards", payload: { thumbnailTexts: texts, bodyMarkdown: body }, summary, suggestedFollowups: follow },
  };
}

function latestVideoSection(ctx: ChatContext, comments: VideoComment[] | null | undefined): string {
  const latest = ctx.recentVideos[0];
  if (!latest) return "<latest_video>The creator has no synced long-form videos yet.</latest_video>";
  const ranked = [...ctx.recentVideos.slice(0, 10)].sort((x, y) => y.views - x.views);
  const rank = ranked.findIndex((v) => v.videoId === latest.videoId) + 1;
  const lines = [
    `<latest_video>`,
    `Title: "${latest.title}" (videoId=${latest.videoId}), published ${latest.publishedAt?.slice(0, 10) ?? "?"}`,
    `Views: ${latest.views.toLocaleString("en-US")}; ${latest.multiplier != null ? `${latest.multiplier.toFixed(1)}x the channel's recent average` : "no multiplier yet"}; ranks #${rank} by views among the last ${ranked.length} long-form videos.`,
  ];
  if (comments?.length) {
    lines.push(`Top comments (likes in brackets):`);
    for (const c of comments.slice(0, 40)) lines.push(`- [${c.likes}]${c.isCreator ? " (creator)" : ""} ${c.text.replace(/\s+/g, " ")}`);
  } else {
    lines.push("Comments: not available.");
  }
  lines.push(`</latest_video>`);
  return lines.join("\n");
}

async function generateMarkdown(a: GenArgs): Promise<Reply> {
  const { state, send, signal, ctx, route, research, turns, input } = a;
  const makeParser = () =>
    new JsonStreamParser({
      onStringChunk: (path, chunk) => {
        if (path.length === 1 && path[0] === "markdown") {
          state.markdown += chunk;
          send({ text_delta: chunk });
        }
      },
    });
  let parser = makeParser();
  const guidance = INTENT_GUIDANCE[route.intent] ?? INTENT_GUIDANCE.general!;
  const result = await callModel(state, {
    system: MARKDOWN_SYSTEM,
    messages: [
      ...turns,
      {
        role: "user",
        content: userTurn([
          renderChannelContext(ctx, { videos: "full" }),
          route.intent === "latest_video_analysis" ? latestVideoSection(ctx, a.comments) : "",
          researchSection(research),
          `<task>\n${guidance}\n</task>`,
          `<request>\n${route.topic ? `Topic: ${route.topic}\n` : ""}Creator's message: ${input.message}\n</request>`,
        ]),
      },
    ],
    effort: "medium",
    maxTokens: 24_000,
    schema: MarkdownSchema,
    signal,
    onJsonDelta: (chunk) => parser.write(chunk),
    onJsonReset: () => {
      state.markdown = "";
      parser = makeParser();
    },
  });
  state.model = result.model;
  const out = result.json as MarkdownOutput;
  const markdown = state.evidence.groundMarkdown(out.markdown.trim());
  const follow = followups(out.suggestedFollowups);
  return {
    content: markdown,
    cards: follow.length ? { suggestedFollowups: follow } : null,
    canonical: { version: SSE_VERSION, type: "markdown", payload: { markdown }, suggestedFollowups: follow },
  };
}

function finishReply(input: StreamInput, state: State, send: Send, reply: Reply) {
  const credits = chargeUsage(input, state, input.assistantMessageId);
  const meta = baseMeta(input, state, credits);
  insertMessage({ id: input.assistantMessageId, chatId: input.chatId, role: "assistant", content: reply.content, cards: reply.cards, metadata: meta });
  send({
    done: true,
    messageId: input.assistantMessageId,
    canonical: reply.canonical,
    metadata: { ...(reply.cards ?? {}), intent: state.intent, provider: state.provider, model: state.model },
    videoMap: state.evidence.videoMap,
    ...(credits != null ? { credits } : {}),
  });
}

/** "Stop generating": keep whatever was already streamed. */
function finishCancelled(input: StreamInput, state: State, send: Send) {
  if (input.expand) {
    const batch = saveExpansion(input, state, state.expansionTitles, true);
    send({
      done: true,
      cancelled: true,
      messageId: input.expand.messageId,
      canonical: batch
        ? { version: SSE_VERSION, type: "titles", payload: { messageId: input.expand.messageId, cardId: input.expand.cardId, batch }, suggestedFollowups: [] }
        : null,
      metadata: { cancelled: true },
      videoMap: state.evidence.videoMap,
    });
    return;
  }
  const credits = chargeUsage(input, state, input.assistantMessageId);
  const partialCards = [...state.cards.filter(Boolean)];
  for (const [ai, titles] of state.pendingTitles) {
    if (!titles.length) continue;
    const head = state.heads.get(ai) ?? {};
    partialCards[ai] = {
      id: `angle_${ai + 1}`,
      name: head.name ?? titles[0].angle ?? "Angle",
      emoji: head.emoji ?? titles[0].angleEmoji ?? "💡",
      description: head.description ?? "",
      titles,
      isRecommended: false,
    };
  }
  const cards = partialCards.filter(Boolean);
  let reply: { content: string; cards: MessageCards | null; canonical: Canonical | null };
  if (cards.length) {
    reply = {
      content: state.summary,
      cards: { summary: state.summary, intro: state.summary, angleCards: cards },
      canonical: { version: SSE_VERSION, type: "cards", payload: { angleCards: cards }, summary: state.summary, suggestedFollowups: [] },
    };
  } else if (state.thumbnailTexts.length) {
    const texts = state.thumbnailTexts.filter(Boolean);
    reply = {
      content: state.summary,
      cards: { summary: state.summary, thumbnailTexts: texts },
      canonical: { version: SSE_VERSION, type: "cards", payload: { thumbnailTexts: texts }, summary: state.summary, suggestedFollowups: [] },
    };
  } else {
    const markdown = state.markdown.trim() ? state.evidence.groundMarkdown(state.markdown) : "";
    reply = {
      content: markdown,
      cards: null,
      canonical: markdown ? { version: SSE_VERSION, type: "markdown", payload: { markdown }, suggestedFollowups: [] } : null,
    };
  }
  insertMessage({
    id: input.assistantMessageId,
    chatId: input.chatId,
    role: "assistant",
    content: reply.content,
    cards: reply.cards,
    metadata: { ...baseMeta(input, state, credits), cancelled: true },
  });
  send({
    done: true,
    cancelled: true,
    messageId: input.assistantMessageId,
    canonical: reply.canonical,
    metadata: { cancelled: true },
    videoMap: state.evidence.videoMap,
    ...(credits != null ? { credits } : {}),
  });
}

// ------------------------------------------------------------------ "More titles →"

function saveExpansion(input: StreamInput, state: State, titles: ChatTitle[], cancelled: boolean): CardExpansionBatch | null {
  if (!input.expand) return null;
  const parent = getMessage(input.expand.messageId);
  if (!parent?.cards) return null;
  const cards: MessageCards = { ...parent.cards, expansions: { ...(parent.cards.expansions ?? {}) } };
  const list = cards.expansions![input.expand.cardId] ?? [];
  const batch: CardExpansionBatch = {
    batchIndex: list.length,
    generationId: input.generationId,
    titles,
    createdAt: new Date().toISOString(),
    ...(cancelled ? { cancelled: true } : {}),
  };
  if (titles.length) {
    cards.expansions![input.expand.cardId] = [...list, batch];
    updateMessageCards(parent.id, cards);
  }
  // Charge the batch to the message it expands.
  chargeUsage(input, state, parent.id);
  return titles.length ? batch : null;
}

async function runExpansion(input: StreamInput, state: State, send: Send, signal: AbortSignal) {
  const expand = input.expand!;
  const parent = getMessage(expand.messageId);
  if (!parent || parent.chatId !== input.chatId || parent.role !== "assistant") throw new AiError("api", "That message no longer exists.");
  const cardIndex = parent.cards?.angleCards?.findIndex((c) => c.id === expand.cardId) ?? -1;
  const card = cardIndex >= 0 ? parent.cards!.angleCards![cardIndex] : null;
  if (!card) throw new AiError("api", "That angle no longer exists.");
  const chat = getChatRow(input.chatId);

  send(stage("_loading_context"));
  const ctx = loadContext(input.chatId, chat?.user_channel_id ?? null);
  const previous = [...card.titles, ...(parent.cards?.expansions?.[card.id] ?? []).flatMap((b) => b.titles)];
  const batchIndex = (parent.cards?.expansions?.[card.id] ?? []).length;

  send(stage("_deep_research"));
  const queries = parent.metadata?.searchQueries?.length ? parent.metadata.searchQueries : [parent.metadata?.topic ?? card.name];
  const research = researchTopic({ queries: [...queries, card.name], niches: ctx.primaryNiches, limit: 40 });
  state.evidence.addVideos(research.videos);
  state.evidence.addStats(research.stats);
  const usedIds = new Set(previous.flatMap((t) => (t.derivation?.match(/[A-Za-z0-9_-]{11}/g) ?? [])));
  for (const v of lookupVideos([...usedIds]).values()) state.evidence.addVideos([v]);
  state.route = { intent: "more_titles", topic: parent.metadata?.topic ?? "", searchQueries: queries, focusAngle: card.name, chatTitle: "", usage: null, model: null, heuristic: true };

  send(stage("_generating", "more_titles"));
  const head = { name: card.name, emoji: card.emoji };
  const idFor = (i: number) => `title_${cardIndex + 1}_m${batchIndex + 1}_${i + 1}`;
  const makeParser = () =>
    new JsonStreamParser({
      onValue: (path, value) => {
        if (path.length === 2 && path[0] === "titles" && typeof path[1] === "number") {
          const title = buildTitle(value as GeneratedTitleOutput, idFor(path[1]), head, state.evidence);
          state.expansionTitles[path[1]] = title;
          send({ title });
        }
      },
    });
  let parser = makeParser();
  const result = await callModel(state, {
    system: MORE_TITLES_SYSTEM,
    messages: [
      {
        role: "user",
        content: userTurn([
          renderChannelContext(ctx, { videos: "brief" }),
          `<research>\nOutlier videos matching the topic:\n${renderVideos(research.videos)}\n\nLibrary stats:\n${renderStats(research.stats)}\n</research>`,
          `<angle>\nName: ${card.emoji} ${card.name}\nWhy it clicks: ${card.description}\nVideo topic: ${parent.metadata?.topic ?? "(see titles)"}\nTitles already written (don't repeat them):\n${previous.map((t) => `- ${t.title}`).join("\n")}\n</angle>`,
          `<request>Write ${MORE_TITLES_BATCH} new titles for this angle.</request>`,
        ]),
      },
    ],
    effort: "medium",
    maxTokens: 12_000,
    schema: MoreTitlesSchema,
    signal,
    onJsonDelta: (chunk) => parser.write(chunk),
    onJsonReset: () => {
      state.expansionTitles = [];
      parser = makeParser();
    },
  });
  state.model = result.model;
  const out = result.json as MoreTitlesOutput;
  const titles = out.titles.map((t, i) => buildTitle(t, idFor(i), head, state.evidence));
  const batch = saveExpansion(input, state, titles, false);
  // Keep the parent's videoMap complete for the new inspiration sources.
  const fresh = getMessage(parent.id);
  if (fresh) {
    const meta: MessageMeta = { ...(fresh.metadata ?? {}), videoMap: { ...(fresh.metadata?.videoMap ?? {}), ...state.evidence.videoMap } };
    updateMessageMeta(parent.id, meta);
  }
  send({
    done: true,
    messageId: parent.id,
    canonical: batch
      ? { version: SSE_VERSION, type: "titles", payload: { messageId: parent.id, cardId: card.id, batch }, suggestedFollowups: [] }
      : null,
    metadata: { intent: "more_titles", provider: state.provider, model: state.model },
    videoMap: state.evidence.videoMap,
  });
}
