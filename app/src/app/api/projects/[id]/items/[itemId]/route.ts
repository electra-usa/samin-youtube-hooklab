import { NextResponse } from "next/server";
import { removeProjectEntry, updateProjectItem } from "@/lib/projects/store";
import { errorResponse, readJson } from "@/app/api/user/_lib/http";

// Entry ids may arrive percent-encoded ("chat%3A<id>"); decoding an already-decoded id is a no-op.
const entryId = (raw: string) => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

// PATCH /api/projects/[id]/items/[itemId] { payload } -> { item }   (edit a note or saved title)
export async function PATCH(req: Request, ctx: RouteContext<"/api/projects/[id]/items/[itemId]">) {
  const { id, itemId } = await ctx.params;
  try {
    const body = await readJson(req);
    const item = updateProjectItem(id, entryId(itemId), body.payload ?? body);
    return NextResponse.json({ item });
  } catch (err) {
    return errorResponse(err);
  }
}

// DELETE /api/projects/[id]/items/[itemId] -> { success }
// itemId is a project_items id, or chat:<id> / pin:<id> / studio:<id> for linked rows.
export async function DELETE(_req: Request, ctx: RouteContext<"/api/projects/[id]/items/[itemId]">) {
  const { id, itemId } = await ctx.params;
  try {
    if (!removeProjectEntry(id, entryId(itemId))) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
