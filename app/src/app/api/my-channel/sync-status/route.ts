import { noChannelResponse, resolveUserChannel } from "@/lib/channel/context";
import { getSyncStatus } from "@/lib/channel/sync";

// { success, state: idle|queued|running|completed|failed, detail, lastSyncedAt, … }
export async function GET(req: Request) {
  const channel = resolveUserChannel(new URL(req.url).searchParams.get("userChannelId"));
  if (!channel) return noChannelResponse();
  return Response.json(getSyncStatus(channel.id), { headers: { "Cache-Control": "no-store" } });
}
