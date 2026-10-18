import { NextResponse } from "next/server";
import { appDb } from "@/lib/db/app";
import { liveActiveGeneration } from "@/lib/chat/generations";
import {
  chatMeta,
  deleteChat,
  getChatRow,
  listAttachments,
  listMessages,
  renameChat,
  setChatProject,
} from "@/lib/chat/store";
import type { ChatThreadResponse } from "@/lib/chat/types";

// One chat: messages + meta (GET), rename / move to a project (PATCH), delete (DELETE).

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const row = getChatRow(id);
  if (!row) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  const body: ChatThreadResponse = {
    chat: chatMeta(row),
    messages: listMessages(id),
    attachments: listAttachments(id),
    activeGeneration: liveActiveGeneration(id),
  };
  return NextResponse.json(body);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const row = getChatRow(id);
  if (!row) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { title?: unknown; projectId?: unknown };
  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim().replace(/\s+/g, " ") : "";
    if (!title) return NextResponse.json({ error: "Title can't be empty" }, { status: 400 });
    renameChat(id, title.slice(0, 120));
  }
  if (body.projectId !== undefined) {
    const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : null;
    if (projectId && !appDb().prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId)) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    setChatProject(id, projectId);
  }
  return NextResponse.json({ success: true, chat: chatMeta(getChatRow(id)!) });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getChatRow(id)) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  deleteChat(id);
  return NextResponse.json({ success: true });
}
