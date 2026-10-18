import { noChannelResponse, resolveUserChannel } from "@/lib/channel/context";
import { getNextTargets, getTrophyEligibility, listTrophies } from "@/lib/channel/trophies";
import { getChannelSummary } from "@/lib/channel/videos";

// Everything the Trophy Case shows: earned trophies, the next four targets, eligibility.
export async function GET(req: Request) {
  const channel = resolveUserChannel(new URL(req.url).searchParams.get("userChannelId"));
  if (!channel) return noChannelResponse();
  return Response.json({
    success: true,
    data: {
      channel: getChannelSummary(channel),
      trophies: listTrophies(channel.id),
      nextTargets: getNextTargets(channel.id),
      trophyEligibility: getTrophyEligibility(channel.id),
    },
  });
}
