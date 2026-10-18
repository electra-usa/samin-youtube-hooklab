import { v1Error, v1Handler, v1Json, v1Options } from "@/lib/api-v1/http";
import { LibraryError, listLibraryChannels, removeLibraryChannel } from "@/lib/core/ingest/library";

type Ctx = { params: Promise<{ channelId: string }> };

// GET    /api/v1/library/channels/{channelId} — one added channel.
// DELETE /api/v1/library/channels/{channelId}?purge=1 — stop tracking it (pauses polling;
//        purge also deletes the videos the pipeline stored for it).

export const GET = v1Handler(async (_req: Request, ctx: Ctx) => {
  const { channelId } = await ctx.params;
  const channel = listLibraryChannels().find((c) => c.channelId === channelId);
  return channel ? v1Json({ channel }) : v1Error(404, "not_found", `Channel ${channelId} wasn't added to the library.`);
});

export const DELETE = v1Handler(async (req: Request, ctx: Ctx) => {
  const { channelId } = await ctx.params;
  const purge = /^(1|true|yes)$/i.test(new URL(req.url).searchParams.get("purge") ?? "");
  try {
    return v1Json({ channelId, ...removeLibraryChannel(channelId, { purge }) });
  } catch (err) {
    if (err instanceof LibraryError) return v1Error(err.status, err.status === 404 ? "not_found" : "bad_request", err.message);
    throw err;
  }
});

export const OPTIONS = v1Options;
