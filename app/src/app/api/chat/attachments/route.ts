import { NextResponse } from "next/server";
import { ATTACHMENT_TEXT_BUDGET_CHARS } from "@/lib/chat/constants";
import { normalizeDraftAttachment } from "@/lib/chat/attachments";
import { getChatRow, insertAttachment, listAttachments } from "@/lib/chat/store";

// Save a prepared attachment to an existing chat. Body: { chatId, attachment } → { attachment }.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { chatId?: unknown; attachment?: unknown };
  const chatId = typeof body.chatId === "string" ? body.chatId : "";
  if (!chatId || !getChatRow(chatId)) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  const draft = normalizeDraftAttachment(body.attachment);
  if (!draft.ok) return NextResponse.json({ error: draft.error }, { status: 400 });
  const existing = listAttachments(chatId).reduce((n, a) => n + a.charCount, 0);
  if (existing + (draft.attachment.transcriptText?.length ?? 0) > ATTACHMENT_TEXT_BUDGET_CHARS) {
    return NextResponse.json(
      {
        error: `This chat's attached documents would be too long for the AI to read in full (limit about ${ATTACHMENT_TEXT_BUDGET_CHARS.toLocaleString()} characters in total). Remove an attachment or start a new chat for this document.`,
      },
      { status: 400 },
    );
  }
  return NextResponse.json({ attachment: insertAttachment(chatId, draft.attachment) });
}

export async function GET(req: Request) {
  const chatId = new URL(req.url).searchParams.get("chatId") ?? "";
  if (!chatId || !getChatRow(chatId)) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  return NextResponse.json({ attachments: listAttachments(chatId) });
}
