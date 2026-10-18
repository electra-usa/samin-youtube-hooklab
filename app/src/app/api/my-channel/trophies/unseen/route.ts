import { z } from "zod";
import { resolveUserChannel } from "@/lib/channel/context";
import { listUnseenTrophies, markTrophiesSeen } from "@/lib/channel/trophies";

// New trophies for the "New Trophy" popup; POST { ids } marks them seen.
export async function GET(req: Request) {
  const channel = resolveUserChannel(new URL(req.url).searchParams.get("userChannelId"));
  return Response.json(
    { success: true, data: { trophies: channel ? listUnseenTrophies(channel.id) : [] } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const parsed = z.object({ ids: z.array(z.string()).max(500) }).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ success: false, error: "ids must be an array" }, { status: 400 });
  return Response.json({ success: true, updated: markTrophiesSeen(parsed.data.ids) });
}
