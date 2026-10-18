import { NextResponse } from "next/server";
import { removeUserChannel } from "../../_lib/channels";
import { errorResponse } from "../../_lib/http";

// DELETE /api/user/channels/[id] -> { channels, activeChannelId }   (original: removeChannel)
// Deletes the channel's profile, style guide, chat preferences and synced videos.
export async function DELETE(_req: Request, ctx: RouteContext<"/api/user/channels/[id]">) {
  const { id } = await ctx.params;
  try {
    return NextResponse.json(removeUserChannel(id));
  } catch (err) {
    return errorResponse(err);
  }
}
