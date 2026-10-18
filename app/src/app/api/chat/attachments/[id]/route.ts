import { NextResponse } from "next/server";
import { deleteAttachment, getAttachment, updateAttachmentLabel } from "@/lib/chat/store";

// Rename (PATCH { label }) or remove (DELETE) a chat attachment.

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getAttachment(id)) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { label?: unknown };
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 200) : null;
  updateAttachmentLabel(id, label);
  return NextResponse.json({ attachment: getAttachment(id) });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getAttachment(id)) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  deleteAttachment(id);
  return NextResponse.json({ success: true });
}
