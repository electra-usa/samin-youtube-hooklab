import { NextResponse } from "next/server";
import { addProjectItem, listProjectItems } from "@/lib/projects/store";
import { errorResponse, readJson } from "@/app/api/user/_lib/http";

// GET /api/projects/[id]/items -> { items }
export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/items">) {
  const { id } = await ctx.params;
  try {
    return NextResponse.json({ items: listProjectItems(id) });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/projects/[id]/items { kind, refId?, payload? } -> { item, created }
// kind: chat (also sets chats.project_id) | title | video | bookmark | studio | note.
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/items">) {
  const { id } = await ctx.params;
  try {
    const body = await readJson(req);
    const { item, created } = addProjectItem(id, { kind: body.kind, refId: body.refId, payload: body.payload });
    return NextResponse.json({ item, created }, { status: created ? 201 : 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
