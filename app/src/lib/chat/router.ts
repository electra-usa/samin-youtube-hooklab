import "server-only";
import { AiError, generate, type AiUsage } from "@/lib/ai";
import { summarizeForRouting, type ChatContext } from "./context";
import { ROUTER_SYSTEM } from "./prompts";
import { RouteSchema, type RouteOutput } from "./schemas";
import type { ChatMessageDTO, Intent } from "./types";

// "Routing": one low-effort call that classifies the request, extracts the topic, expands it
// into library search queries and (on the first real exchange) names the chat.

export type Route = RouteOutput & { usage: AiUsage | null; model: string | null; heuristic: boolean };

const STOP = new Set(
  "a about an and are as at be but by can do for from give help how i im in into is it its make me my next of on or our should so that the this to video videos was we what when which who why will with you your".split(" "),
);

function keywordQueries(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  const queries: string[] = [];
  for (let i = 0; i < words.length && queries.length < 5; i += 2) queries.push(words.slice(i, i + 3).join(" "));
  return queries;
}

/** Keyword fallback used when the router call fails for a recoverable reason. */
export function heuristicIntent(message: string, history: ChatMessageDTO[]): Intent {
  const m = message.toLowerCase();
  if (/thumbnail/.test(m)) return "thumbnail";
  if (/\b(vs\.?|versus)\b|decide between|which (title|one) should|which is better/.test(m)) return "compare_titles";
  if (/\bmore titles\b|more like (this|that|angle)/.test(m)) return "more_titles";
  if (/\boutline\b/.test(m)) return "outline";
  if (/\bintro\b|\bhook script\b/.test(m)) return "intro";
  if (/\bdescription\b/.test(m)) return "description";
  if (/channels? (i should|to) study|competitors? (i should|to)|who should i (study|watch)/.test(m)) return "channels_to_study";
  if (/working on youtube|title frameworks?|what'?s working/.test(m)) return "whats_working";
  if (/(latest|last|recent) video/.test(m) && /analy|perform|how did/.test(m)) return "latest_video_analysis";
  if (/audience/.test(m) && /psycholog|want|fear|care/.test(m)) return "audience_psychology";
  if (/grow|holding .* back|strategy|beating me|mistake|growth opportunit/.test(m)) return "channel_strategy";
  if (/\bideas?\b|what (video )?should i make|under-?served|brainstorm/.test(m)) return "video_ideas";
  if (/\btitles?\b/.test(m)) return "titles";
  // A reply to "What is your video about?" continues whatever the creator asked for.
  const lastUser = [...history].reverse().find((h) => h.role === "user");
  const pill = lastUser?.promptPill?.promptId;
  if (pill === "generate_titles") return "titles";
  if (pill === "outline_next_video") return "outline";
  if (pill === "write_next_intro") return "intro";
  if (pill === "brainstorm_ideas") return "video_ideas";
  return "general";
}

export async function routeMessage(args: {
  message: string;
  history: ChatMessageDTO[];
  ctx: ChatContext;
  needTitle: boolean;
  signal: AbortSignal;
}): Promise<Route> {
  const { message, history, ctx } = args;
  const attachmentNote = ctx.attachments.length
    ? `\nAttachments in this chat: ${ctx.attachments.map((a) => `${a.type} "${a.label ?? "untitled"}" (starts: ${(a.transcriptText ?? "").slice(0, 300).replace(/\s+/g, " ")}…)`).join("; ")}`
    : "";
  const prompt = [
    history.length ? `<recent_conversation>\n${summarizeForRouting(history)}\n</recent_conversation>` : "",
    `<creator_niche>${ctx.primaryNiches.join(", ") || "unknown"}${ctx.overview ? ` — ${ctx.overview.slice(0, 400)}` : ""}</creator_niche>${attachmentNote}`,
    `<latest_message>\n${message}\n</latest_message>`,
    args.needTitle ? "A chat title is needed." : "No chat title is needed (leave chatTitle empty).",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const result = await generate({
      system: ROUTER_SYSTEM,
      messages: [{ role: "user", content: prompt }],
      effort: "low",
      maxTokens: 4000,
      schema: RouteSchema,
      signal: args.signal,
    });
    const out = result.json as RouteOutput;
    return {
      ...out,
      searchQueries: out.searchQueries.filter((q) => q.trim()).slice(0, 6),
      usage: result.usage,
      model: result.model,
      heuristic: false,
    };
  } catch (err) {
    // Configuration and cancellation problems would hit the main call too, so surface them now.
    if (err instanceof AiError && ["no_provider", "auth", "aborted", "rate_limit"].includes(err.code)) throw err;
    const intent = heuristicIntent(message, history);
    const topicSource = [message, ...history.filter((h) => h.role === "user").map((h) => h.content)].join(" ");
    return {
      intent,
      topic: message.length > 20 ? message.slice(0, 300) : "",
      searchQueries: keywordQueries(topicSource),
      focusAngle: "",
      chatTitle: "",
      usage: null,
      model: null,
      heuristic: true,
    };
  }
}
