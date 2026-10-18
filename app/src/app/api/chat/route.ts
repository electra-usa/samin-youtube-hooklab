import { NextResponse } from "next/server";
import { ATTACHMENT_TEXT_BUDGET_CHARS, CHAT_MESSAGE_MAX_CHARS, defaultChatTitle } from "@/lib/chat/constants";
import { normalizeDraftAttachments } from "@/lib/chat/attachments";
import { createChat, insertAttachment, insertMessage, resolveUserChannelId } from "@/lib/chat/store";
import type { ChatAttachment, MessageCards, PromptPillMeta } from "@/lib/chat/types";

// Create a chat (original: POST /api/chat with createOnly). Canned prompt pills pass the
// assistant reply too, so no model call happens; otherwise the thread page streams the answer.
// Body: { message, channelId?, createOnly?, assistantMessage?, assistantCards?, attachments?, promptPill?, projectId? }
// → { success: true, data: { chatId, attachments } }
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    message?: unknown;
    channelId?: unknown;
    assistantMessage?: unknown;
    assistantCards?: unknown;
    attachments?: unknown;
    promptPill?: unknown;
    projectId?: unknown;
  } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "Message is required" }, { status: 400 });
  if (message.length > CHAT_MESSAGE_MAX_CHARS) {
    return NextResponse.json({ error: `Messages can be up to ${CHAT_MESSAGE_MAX_CHARS.toLocaleString()} characters.` }, { status: 400 });
  }

  const drafts = normalizeDraftAttachments(body?.attachments);
  if (!drafts.ok) return NextResponse.json({ error: drafts.error }, { status: 400 });
  const total = drafts.attachments.reduce((n, a) => n + (a.transcriptText?.length ?? 0), 0);
  if (total > ATTACHMENT_TEXT_BUDGET_CHARS) {
    return NextResponse.json({ error: "These documents are too long for the AI to read in full. Attach fewer or shorter documents." }, { status: 400 });
  }

  const userChannelId = resolveUserChannelId(body?.channelId);
  const projectId = typeof body?.projectId === "string" && body.projectId ? body.projectId : null;
  const chatId = createChat({ title: defaultChatTitle(message), userChannelId, projectId });

  const saved: ChatAttachment[] = drafts.attachments.map((a) => insertAttachment(chatId, a));
  const pill = body?.promptPill && typeof body.promptPill === "object" ? (body.promptPill as PromptPillMeta) : null;
  insertMessage({
    chatId,
    role: "user",
    content: message,
    attachments: saved.map((a) => ({ id: a.id, type: a.type, label: a.label })),
    promptPill: pill,
  });

  if (typeof body?.assistantMessage === "string" && body.assistantMessage.trim()) {
    const cards = body.assistantCards && typeof body.assistantCards === "object" ? (body.assistantCards as MessageCards) : null;
    insertMessage({ chatId, role: "assistant", content: body.assistantMessage, cards, metadata: { canned: true } });
  }

  return NextResponse.json({ success: true, data: { chatId, attachments: saved } });
}
