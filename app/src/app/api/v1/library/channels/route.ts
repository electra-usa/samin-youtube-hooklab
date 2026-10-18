import { V1Error, v1Error, v1Handler, v1Json, v1Options } from "@/lib/api-v1/http";
import { LibraryError, addLibraryChannel, listLibraryChannels } from "@/lib/core/ingest/library";

// GET  /api/v1/library/channels — channels added from YouTube (by you or discovery).
// POST /api/v1/library/channels {channel: "@handle" | URL | "UC…", backfill?: true, deep?: true}
//      resolves, adds and backfills the channel (RSS + one ScrapeCreators page when deep).

export const GET = v1Handler(() => v1Json({ channels: listLibraryChannels() }));

export const POST = v1Handler(async (req: Request) => {
  let body: { channel?: unknown; backfill?: unknown; deep?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return v1Error(400, "invalid_json", 'Send {"channel": "@handle"}.');
  }
  if (typeof body?.channel !== "string" || !body.channel.trim()) throw new V1Error(400, "channel is required: an @handle, channel URL or UC… id.");
  if (body.backfill != null && typeof body.backfill !== "boolean") throw new V1Error(400, "backfill must be true or false.");
  if (body.deep != null && typeof body.deep !== "boolean") throw new V1Error(400, "deep must be true or false.");
  try {
    const result = await addLibraryChannel(body.channel, { backfill: body.backfill as boolean | undefined, deep: body.deep as boolean | undefined });
    return v1Json(result, { status: result.created ? 201 : 200 });
  } catch (err) {
    if (err instanceof LibraryError) return v1Error(err.status, err.status === 404 ? "not_found" : "bad_request", err.message);
    throw err;
  }
});

export const OPTIONS = v1Options;
