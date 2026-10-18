import { NextResponse } from "next/server";
import { library } from "@/lib/db/library";
import { CHAT_MESSAGE_MAX_CHARS } from "@/lib/chat/constants";
import { isChatGenerating, liveActiveGeneration } from "@/lib/chat/generations";
import { createGenerationStream } from "@/lib/chat/pipeline";
import { getChatRow, getMessage, insertMessage, listMessages } from "@/lib/chat/store";

// SSE stream for one assistant reply (original: POST /api/chat/stream).
// Body: { chatId, message, assistantMessageId, generationId, userMessageId?, expand?: { messageId, cardId } }
//   or { warmup: true, channelId } → {"version":"1.0","ok":true} without calling the model.
// Events are `data: {...}\n\n`; see docs/CHAT.md for the protocol.

const UUIDISH = /^[A-Za-z0-9_-]{8,64}$/;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    warmup?: unknown;
    chatId?: unknown;
    message?: unknown;
    assistantMessageId?: unknown;
    generationId?: unknown;
    userMessageId?: unknown;
    expand?: { messageId?: unknown; cardId?: unknown } | null;
  } | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  if (body.warmup) {
    library(); // open the library database so the first real request doesn't pay for it
    return NextResponse.json({ version: "1.0", ok: true });
  }

  const chatId = typeof body.chatId === "string" ? body.chatId : "";
  const chat = chatId ? getChatRow(chatId) : null;
  if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "Message is required" }, { status: 400 });
  if (message.length > CHAT_MESSAGE_MAX_CHARS) {
    return NextResponse.json({ error: `Messages can be up to ${CHAT_MESSAGE_MAX_CHARS.toLocaleString()} characters.` }, { status: 400 });
  }
  const assistantMessageId = typeof body.assistantMessageId === "string" && UUIDISH.test(body.assistantMessageId) ? body.assistantMessageId : crypto.randomUUID();
  const generationId = typeof body.generationId === "string" && UUIDISH.test(body.generationId) ? body.generationId : crypto.randomUUID();
  if (getMessage(assistantMessageId)) return NextResponse.json({ error: "assistantMessageId already exists" }, { status: 409 });
  if (isChatGenerating(chatId) || liveActiveGeneration(chatId)) {
    return NextResponse.json({ error: "A response is still being generated for this chat." }, { status: 409 });
  }

  let expand: { messageId: string; cardId: string } | null = null;
  if (body.expand && typeof body.expand === "object") {
    const messageId = typeof body.expand.messageId === "string" ? body.expand.messageId : "";
    const cardId = typeof body.expand.cardId === "string" ? body.expand.cardId : "";
    const parent = messageId ? getMessage(messageId) : null;
    if (!parent || parent.chatId !== chatId || !parent.cards?.angleCards?.some((c) => c.id === cardId)) {
      return NextResponse.json({ error: "Angle card not found" }, { status: 404 });
    }
    expand = { messageId, cardId };
  }

  // The new-chat page already saved the first user message; later turns are saved here.
  let userMessageId: string | null = null;
  if (!expand) {
    const messages = listMessages(chatId);
    const last = messages[messages.length - 1];
    if (last && last.role === "user" && last.content.trim() === message) {
      userMessageId = last.id;
    } else {
      const requested = typeof body.userMessageId === "string" && UUIDISH.test(body.userMessageId) && !getMessage(body.userMessageId) ? body.userMessageId : undefined;
      userMessageId = insertMessage({ id: requested, chatId, role: "user", content: message });
    }
  }

  const stream = createGenerationStream({ chatId, message, userMessageId, assistantMessageId, generationId, expand });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
