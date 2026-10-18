import "server-only";
import { CHAT_MESSAGE_MAX_CHARS, defaultChatTitle } from "@/lib/chat/constants";
import { createGenerationStream } from "@/lib/chat/pipeline";
import { createChat, getMessage, insertMessage, resolveUserChannelId } from "@/lib/chat/store";
import { SSE_VERSION, type AngleCard, type VideoMap } from "@/lib/chat/types";
import { QueryError } from "@/lib/core/query";
import { listUserChannels } from "@/lib/db/app";

// POST /api/v1/titles runs the same pipeline as the chat UI: it creates a chat (so the result
// shows up in /chats), saves the request as the user message, and streams the reply.

export type TitlesRequest = { idea: string; channelId: string | null; stream: boolean };

export function parseTitlesRequest(body: unknown): TitlesRequest {
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!b) throw new QueryError("Send a JSON body: {\"idea\": \"what your video is about\"}.", { code: "invalid_body" });
  const idea = typeof b.idea === "string" ? b.idea.trim() : "";
  if (!idea) throw new QueryError("idea is required: describe the video you want titles for.", { code: "invalid_parameter" });
  if (idea.length > CHAT_MESSAGE_MAX_CHARS - 200) {
    throw new QueryError(`idea can be up to ${(CHAT_MESSAGE_MAX_CHARS - 200).toLocaleString("en-US")} characters.`, { code: "invalid_parameter" });
  }
  if (b.channelId != null && typeof b.channelId !== "string") throw new QueryError("channelId must be a string.", { code: "invalid_parameter" });
  if (b.stream != null && typeof b.stream !== "boolean") throw new QueryError("stream must be true or false.", { code: "invalid_parameter" });
  const channelId = typeof b.channelId === "string" && b.channelId.trim() ? b.channelId.trim() : null;
  if (channelId) {
    const channels = listUserChannels();
    if (!channels.some((c) => c.id === channelId || c.channelId === channelId)) {
      throw new QueryError(`channelId "${channelId}" isn't one of your channels.`, {
        code: "invalid_parameter",
        details: { channels: channels.map((c) => ({ id: c.id, channelId: c.channelId, name: c.name })) },
      });
    }
  }
  return { idea, channelId, stream: b.stream === true };
}

export type StartedGeneration = {
  chatId: string;
  userMessageId: string;
  assistantMessageId: string;
  generationId: string;
  stream: ReadableStream<Uint8Array>;
};

export function startTitles(req: TitlesRequest): StartedGeneration {
  const message = `Write YouTube titles for my video: ${req.idea}`;
  const userChannelId = resolveUserChannelId(req.channelId);
  // The default title (from the message) lets the pipeline rename the chat, like chats started in the UI.
  const chatId = createChat({ title: defaultChatTitle(message), userChannelId });
  const userMessageId = insertMessage({ chatId, role: "user", content: message });
  const assistantMessageId = crypto.randomUUID();
  const generationId = crypto.randomUUID();
  const stream = createGenerationStream({ chatId, message, userMessageId, assistantMessageId, generationId, expand: null });
  return { chatId, userMessageId, assistantMessageId, generationId, stream };
}

/** The pipeline's SSE stream with a leading `chat` event, so stream clients learn the chat id first. */
export function withChatEvent(g: StartedGeneration, chatUrl: string): ReadableStream<Uint8Array> {
  const reader = g.stream.getReader();
  const head = `data: ${JSON.stringify({
    version: SSE_VERSION,
    chat: { id: g.chatId, url: chatUrl, messageId: g.assistantMessageId, generationId: g.generationId },
  })}\n\n`;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(head));
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      // The generation keeps running and is saved to the chat (same as closing the chat tab).
      return reader.cancel(reason);
    },
  });
}

type Event = Record<string, unknown>;

/** Read an SSE stream to the end; returns every `data:` event. */
export async function readEvents(stream: ReadableStream<Uint8Array>): Promise<Event[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const events: Event[] = [];
  let buffer = "";
  const flush = (block: string) => {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    try {
      events.push(JSON.parse(data) as Event);
    } catch {
      // not JSON; ignore
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buffer.indexOf("\n\n")) >= 0) {
      flush(buffer.slice(0, i));
      buffer = buffer.slice(i + 2);
    }
  }
  flush(buffer + decoder.decode());
  return events;
}

export type TitlesResult = {
  chatId: string;
  chatUrl: string;
  messageId: string;
  generationId: string;
  intent: string | null;
  topic: string | null;
  summary: string;
  angleCards: AngleCard[];
  bodyMarkdown: string;
  /** Set instead of angle cards when the request was answered in prose. */
  markdown: string | null;
  suggestedFollowups: string[];
  videoMap: VideoMap;
  provider: string | null;
  model: string | null;
  credits: number | null;
  durationMs: number;
};

/** Run the generation to completion and read the saved reply. Errors come back as `{ error }`. */
export async function collectTitles(
  g: StartedGeneration,
  chatUrl: string,
  startedAt: number,
): Promise<{ result: TitlesResult } | { error: { code: string; message: string }; chatId: string; chatUrl: string }> {
  const events = await readEvents(g.stream);
  const failure = events.find((e) => typeof e.error === "string");
  if (failure) {
    return { error: { code: String(failure.code ?? "generation_failed"), message: String(failure.error) }, chatId: g.chatId, chatUrl };
  }
  const saved = getMessage(g.assistantMessageId);
  const done = events.find((e) => e.done === true) as { canonical?: { type?: string; payload?: { markdown?: string } } } | undefined;
  if (!saved) {
    return { error: { code: "generation_failed", message: "The generation ended without a reply." }, chatId: g.chatId, chatUrl };
  }
  const cards = saved.cards ?? {};
  const meta = saved.metadata ?? {};
  const isMarkdown = !cards.angleCards?.length && (done?.canonical?.type === "markdown" || !!saved.content);
  return {
    result: {
      chatId: g.chatId,
      chatUrl,
      messageId: g.assistantMessageId,
      generationId: g.generationId,
      intent: meta.intent ?? null,
      topic: meta.topic ?? null,
      summary: cards.summary ?? "",
      angleCards: cards.angleCards ?? [],
      bodyMarkdown: cards.bodyMarkdown ?? "",
      markdown: isMarkdown ? (done?.canonical?.payload?.markdown ?? saved.content) : null,
      suggestedFollowups: cards.suggestedFollowups ?? [],
      videoMap: meta.videoMap ?? {},
      provider: meta.provider ?? null,
      model: meta.model ?? null,
      credits: meta.credits ?? null,
      durationMs: Date.now() - startedAt,
    },
  };
}
