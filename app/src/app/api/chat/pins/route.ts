import { NextResponse } from "next/server";
import { appDb, newId, nowIso } from "@/lib/db/app";
import { getChatRow, getPin, listPins } from "@/lib/chat/store";

// Pinned titles (original: SavedTitle). Pinning a title in a chat that belongs to a project
// also files it in that project as a project_items row of kind "title".

export async function GET(req: Request) {
  const chatId = new URL(req.url).searchParams.get("chatId");
  return NextResponse.json({ pins: listPins(chatId) });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    chatId?: unknown;
    messageId?: unknown;
    title?: unknown;
    angle?: unknown;
    clickTrigger?: unknown;
    cardKey?: unknown;
  };
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  const chatId = typeof body.chatId === "string" && body.chatId ? body.chatId : null;
  const chat = chatId ? getChatRow(chatId) : null;
  if (chatId && !chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : undefined);
  const meta = { angle: str(body.angle), clickTrigger: str(body.clickTrigger), cardKey: str(body.cardKey) };
  const messageId = str(body.messageId) ?? null;
  const projectId = chat?.project_id ?? null;

  const db = appDb();
  const id = newId();
  const now = nowIso();
  db.exec("BEGIN");
  let projectItemId: string | null = null;
  try {
    db.prepare("INSERT INTO pinned_titles (id, title, chat_id, message_id, project_id, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      id,
      title,
      chatId,
      messageId,
      projectId,
      JSON.stringify(meta),
      now,
    );
    if (projectId) {
      projectItemId = newId();
      db.prepare("INSERT INTO project_items (id, project_id, kind, ref_id, payload_json, created_at) VALUES (?, ?, 'title', ?, ?, ?)").run(
        projectItemId,
        projectId,
        id,
        JSON.stringify({ title, chatId, messageId, ...meta }),
        now,
      );
      db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, projectId);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return NextResponse.json({ pin: getPin(id), projectItemId });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const body = (await req.json().catch(() => ({}))) as { id?: unknown };
  const id = url.searchParams.get("id") ?? (typeof body.id === "string" ? body.id : "");
  if (!id || !getPin(id)) return NextResponse.json({ error: "Pin not found" }, { status: 404 });
  const db = appDb();
  db.prepare("DELETE FROM project_items WHERE kind = 'title' AND ref_id = ?").run(id);
  db.prepare("DELETE FROM pinned_titles WHERE id = ?").run(id);
  return NextResponse.json({ success: true });
}
