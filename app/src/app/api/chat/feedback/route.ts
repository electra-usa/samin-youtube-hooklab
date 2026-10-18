import { NextResponse } from "next/server";
import { appDb, newId, nowIso } from "@/lib/db/app";
import { TITLE_FEEDBACK_REASONS } from "@/lib/taxonomy";
import { getMessage, setMessageFeedback } from "@/lib/chat/store";

// Thumbs up/down on a reply (original body: { chatMessageId, chatId, rating, reason?, comment? }),
// plus optional per-title feedback when `title` is given. Every rating is logged in
// title_feedback (title "" = the whole reply); message-level ratings also update
// chat_messages.feedback so the thread shows them after a reload.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    chatMessageId?: unknown;
    chatId?: unknown;
    rating?: unknown;
    reason?: unknown;
    comment?: unknown;
    title?: unknown;
  };
  const messageId = typeof body.chatMessageId === "string" ? body.chatMessageId : "";
  const message = messageId ? getMessage(messageId) : null;
  if (!message || (typeof body.chatId === "string" && body.chatId && message.chatId !== body.chatId)) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }
  const rating = body.rating === "positive" || body.rating === "negative" ? body.rating : null;
  if (!rating) return NextResponse.json({ error: "rating must be positive or negative" }, { status: 400 });
  const reason =
    typeof body.reason === "string" && TITLE_FEEDBACK_REASONS.some((r) => r.value === body.reason) ? body.reason : undefined;
  const comment = typeof body.comment === "string" && body.comment.trim() ? body.comment.trim().slice(0, 2000) : undefined;
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 300) : "";

  appDb()
    .prepare("INSERT INTO title_feedback (id, message_id, title, rating, reason, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(newId(), messageId, title, rating, reason ?? null, comment ?? null, nowIso());
  if (!title) setMessageFeedback(messageId, { rating, ...(reason ? { reason } : {}), ...(comment ? { comment } : {}) });
  return NextResponse.json({ success: true });
}
