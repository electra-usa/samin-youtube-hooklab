import { UsageError, parseFlags } from "../args.ts";
import { bold, dim, paint, terminalWidth, wrap } from "../format.ts";
import type { CliContext, Command } from "../types.ts";

// Talks to a running HookLab server (POST /api/v1/titles): generation needs the app's chat
// pipeline, channel context and Claude provider, which live in the server process.

type ChatTitle = { title: string; clickTrigger?: string; inspirationSources?: { title: string; channelName: string }[] };
type AngleCard = { name: string; emoji: string; description: string; titles: ChatTitle[]; isRecommended: boolean; recommendationReason?: string };
type TitlesResult = {
  chatId: string;
  chatUrl: string;
  intent: string | null;
  summary: string;
  angleCards: AngleCard[];
  bodyMarkdown: string;
  markdown: string | null;
  suggestedFollowups: string[];
  model: string | null;
  credits: number | null;
  durationMs: number;
};

const STAGES: Record<string, string> = {
  _preparing: "Getting started",
  _routing: "Reading the idea",
  _loading_context: "Loading your channel context",
  _deep_research: "Researching outliers in the library",
  _generating: "Writing titles",
};

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  const key = process.env.HOOKLAB_API_KEY?.trim();
  if (key) h.Authorization = `Bearer ${key}`;
  return h;
}

async function post(ctx: CliContext, body: unknown): Promise<Response> {
  try {
    return await fetch(`${ctx.serverUrl}/api/v1/titles`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause?.code;
    throw new Error(
      `Can't reach HookLab at ${ctx.serverUrl}${cause ? ` (${cause})` : ""}. Start it with \`hooklab serve\`, or set HOOKLAB_URL.`,
    );
  }
}

async function failure(res: Response): Promise<Error> {
  const text = await res.text();
  let message = text.slice(0, 500) || res.statusText;
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string; chatUrl?: string };
    const e = parsed.error;
    message = (typeof e === "string" ? e : e?.message) ?? message;
    if (parsed.chatUrl) message += `\nChat: ${parsed.chatUrl}`;
  } catch {
    // plain text body
  }
  if (res.status === 401) message += "\nSet HOOKLAB_API_KEY to the server's key.";
  const err = new Error(`${message} (HTTP ${res.status})`);
  if (res.status === 400) err.name = "UsageError";
  return err;
}

function renderCards(result: Pick<TitlesResult, "angleCards" | "summary" | "suggestedFollowups" | "markdown" | "bodyMarkdown">): string {
  const width = Math.min(terminalWidth(), 110);
  const out: string[] = [];
  if (result.markdown && !result.angleCards.length) {
    out.push(result.markdown.trim(), "");
  }
  result.angleCards.forEach((card, i) => {
    const head = `${i + 1}. ${card.emoji} ${card.name}`;
    out.push(card.isRecommended ? `${bold(head)}  ${paint("green", "★ recommended")}` : bold(head));
    if (card.description) out.push(dim(wrap(card.description, width, "   ")));
    card.titles.forEach((t) => {
      out.push(`   • ${t.title}${t.clickTrigger ? `  ${dim(`[${t.clickTrigger}]`)}` : ""}`);
      const src = t.inspirationSources?.[0];
      if (src) out.push(dim(`     ↳ modeled on “${src.title}” — ${src.channelName}`));
    });
    if (card.recommendationReason) out.push(paint("green", wrap(`Why: ${card.recommendationReason}`, width, "   ")));
    out.push("");
  });
  if (result.summary) out.push(wrap(result.summary, width), "");
  if (result.suggestedFollowups.length) {
    out.push(dim("Try next:"), ...result.suggestedFollowups.map((f) => `  • ${f}`), "");
  }
  return out.join("\n");
}

/** Title rows for --jsonl / --csv. */
function titleRows(result: TitlesResult): Record<string, unknown>[] {
  return result.angleCards.flatMap((card, i) =>
    card.titles.map((t) => ({
      angle: i + 1,
      angleName: card.name,
      emoji: card.emoji,
      recommended: card.isRecommended,
      title: t.title,
      clickTrigger: t.clickTrigger ?? "",
      inspiredBy: t.inspirationSources?.[0]?.title ?? "",
      inspiredByChannel: t.inspirationSources?.[0]?.channelName ?? "",
      chatUrl: result.chatUrl,
    })),
  );
}

/** Read the SSE stream, narrating progress on stderr; resolves with the final cards. */
async function followStream(res: Response, ctx: CliContext): Promise<TitlesResult> {
  if (!res.body) throw new Error("The server sent an empty response.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const started = Date.now();
  const tty = !!process.stderr.isTTY;
  const secs = () => `${Math.round((Date.now() - started) / 1000)}s`;
  let buffer = "";
  let chatUrl = "";
  let chatId = "";
  let lastStage = "";
  let titles = 0;
  let final: TitlesResult | null = null;
  let error: string | null = null;

  const status = (text: string) => {
    if (tty) process.stderr.write(`\r\x1b[K${dim(text, process.stderr)}`);
  };
  const line = (text: string) => {
    if (tty) process.stderr.write("\r\x1b[K");
    ctx.info(text);
  };

  const handle = (e: Record<string, unknown>) => {
    if (e.chat && typeof e.chat === "object") {
      const c = e.chat as { id: string; url: string };
      chatId = c.id;
      chatUrl = c.url;
      line(dim(`Chat: ${chatUrl}`, process.stderr));
    } else if (typeof e.tool_name === "string") {
      lastStage = STAGES[e.tool_name] ?? e.tool_name;
      status(`${lastStage}… ${secs()}`);
    } else if (e.title && typeof e.title === "object") {
      titles++;
      status(`${lastStage}… ${titles} title${titles === 1 ? "" : "s"} · ${secs()}`);
    } else if (e.card && typeof e.card === "object") {
      const c = e.card as AngleCard;
      line(`  ${paint("green", "✓", process.stderr)} ${c.emoji} ${c.name} ${dim(`(${secs()})`, process.stderr)}`);
    } else if (typeof e.error === "string") {
      error = e.error;
    } else if (e.done === true) {
      const canonical = e.canonical as { type?: string; payload?: { angleCards?: AngleCard[]; markdown?: string; bodyMarkdown?: string }; summary?: string; suggestedFollowups?: string[] } | null;
      const meta = (e.metadata ?? {}) as { intent?: string; model?: string };
      final = {
        chatId,
        chatUrl,
        intent: meta.intent ?? null,
        summary: canonical?.summary ?? "",
        angleCards: canonical?.payload?.angleCards ?? [],
        bodyMarkdown: canonical?.payload?.bodyMarkdown ?? "",
        markdown: canonical?.type === "markdown" ? (canonical.payload?.markdown ?? "") : null,
        suggestedFollowups: canonical?.suggestedFollowups ?? [],
        model: meta.model ?? null,
        credits: typeof e.credits === "number" ? e.credits : null,
        durationMs: Date.now() - started,
      };
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        handle(JSON.parse(data) as Record<string, unknown>);
      } catch {
        // ignore malformed events
      }
    }
  }
  if (tty) process.stderr.write("\r\x1b[K");
  if (error) throw new Error(`${error}${chatUrl ? `\nChat: ${chatUrl}` : ""}`);
  if (!final) throw new Error(`The stream ended before the answer was finished.${chatUrl ? ` It may still land in ${chatUrl}` : ""}`);
  return final;
}

const command: Command = {
  name: "titles",
  summary: "Generate title ideas for a video (needs a running HookLab server)",
  usage: `Usage: hooklab titles "<video idea>" [--channel ID] [--no-stream]

Runs HookLab's title pipeline — Claude, grounded in real outliers from the library — through
the running server (POST /api/v1/titles, HOOKLAB_URL, default http://localhost:3210). Takes
about 40 seconds; progress goes to stderr. Every run is also saved as a chat in the app.

  --channel ID   write for one of your channels (user channel id or UC… id; default: active)
  --no-stream    wait for the final answer instead of following progress

--json prints the full result (cards, summary, follow-ups, chat URL); --jsonl/--csv print one
row per title.

Examples
  hooklab titles "I automated my whole YouTube workflow with Claude"
  hooklab titles "budget travel in Japan for 2 weeks" --json > titles.json
  hooklab titles "the best free AI tools for students" --csv`,
  async run(argv, ctx) {
    const { values, positionals } = parseFlags(argv, { channel: { type: "string" }, "no-stream": { type: "boolean" } });
    const idea = positionals.join(" ").trim();
    if (!idea) throw new UsageError('Describe the video: hooklab titles "what the video is about".');
    const stream = ctx.format === "table" && !values["no-stream"];
    ctx.info(dim(`Writing titles for “${idea.length > 80 ? `${idea.slice(0, 79)}…` : idea}” via ${ctx.serverUrl} …`, process.stderr));
    const res = await post(ctx, { idea, ...(values.channel ? { channelId: values.channel } : {}), stream });
    if (!res.ok) throw await failure(res);

    let result: TitlesResult;
    if (stream) result = await followStream(res, ctx);
    else result = ((await res.json()) as { data: TitlesResult }).data;

    if (ctx.format === "json") ctx.print(result as unknown as Record<string, unknown>);
    else if (ctx.format === "jsonl" || ctx.format === "csv") ctx.print(titleRows(result));
    else process.stdout.write(renderCards(result));
    ctx.info(
      dim(
        `${result.angleCards.reduce((n, c) => n + c.titles.length, 0)} titles in ${result.angleCards.length} angles · ${Math.round(result.durationMs / 1000)}s${result.credits != null ? ` · ${result.credits} credits` : ""}${result.model ? ` · ${result.model}` : ""}\nOpen in HookLab: ${result.chatUrl}`,
        process.stderr,
      ),
    );
  },
};

export default command;
