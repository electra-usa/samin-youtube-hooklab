import type { NextRequest } from "next/server";
import { readUpload } from "../../_lib/store";

// Serves an uploaded Studio thumbnail (keys are immutable, so cache hard).
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/studio/thumbnails/[key]">) {
  const file = readUpload((await ctx.params).key);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(file.data.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
