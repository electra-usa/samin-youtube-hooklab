import { NextResponse } from "next/server";
import { connection } from "next/server";
import { createTag, listTags } from "@/lib/research/bookmarks";
import { errorResponse, readBody } from "@/lib/research/http";

// GET -> { tags: [{ id, name, count }] }
export async function GET() {
  await connection();
  return NextResponse.json({ tags: listTags() });
}

// POST { name } -> { tag }
export async function POST(req: Request) {
  const body = await readBody(req);
  try {
    return NextResponse.json({ tag: createTag(body.name) }, { status: 201 });
  } catch (err) {
    return errorResponse(err, "Failed to create tag");
  }
}
