import { z } from "zod";
import { noChannelResponse, resolveUserChannel } from "@/lib/channel/context";
import { getSyncStatus, startChannelSync } from "@/lib/channel/sync";

const Body = z.object({
  userChannelId: z.string().optional(),
  /** Exact per-video stats for every upload (slow without YOUTUBE_API_KEY). */
  deep: z.boolean().optional(),
  /** Skip when the channel synced in the last 24 hours (the page-load check). */
  ifStale: z.boolean().optional(),
});

// Start a background sync of your channel's uploads (original: queueChannelSync /
// ensureChannelVideosSynced server actions). Poll /api/my-channel/sync-status.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ success: false, error: "Invalid request" }, { status: 400 });
  const channel = resolveUserChannel(parsed.data.userChannelId);
  if (!channel) return noChannelResponse();
  const result = startChannelSync(channel.id, { deep: parsed.data.deep, ifStale: parsed.data.ifStale });
  return Response.json(result, { status: result.success ? 202 : 400 });
}

export async function GET(req: Request) {
  const channel = resolveUserChannel(new URL(req.url).searchParams.get("userChannelId"));
  if (!channel) return noChannelResponse();
  return Response.json(getSyncStatus(channel.id));
}
