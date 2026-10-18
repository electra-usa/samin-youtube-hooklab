import { NextResponse } from "next/server";
import { connection } from "next/server";
import {
  addChannelToList,
  createList,
  followedChannelIds,
  listFollowingLists,
  startSync,
  type ChannelInput,
} from "@/lib/research/following";
import { errorResponse, readBody } from "@/lib/research/http";

// Following lists (original getFollowingLists / createList).
export async function GET() {
  await connection();
  return NextResponse.json({ lists: listFollowingLists(), followedChannelIds: followedChannelIds() });
}

// Create a list, optionally with the channels picked in the "New list" dialog.
export async function POST(req: Request) {
  const body = await readBody(req);
  try {
    const list = createList(body.name, typeof body.type === "string" ? body.type : null);
    const failed: string[] = [];
    const added: string[] = [];
    if (Array.isArray(body.channels)) {
      for (const c of body.channels as ChannelInput[]) {
        try {
          added.push(addChannelToList(list.id, c).channelId);
        } catch {
          failed.push(String(c?.channelName ?? c?.channelId ?? "channel"));
        }
      }
    }
    if (added.length) startSync({ channelIds: added, onlyStale: true });
    const fresh = listFollowingLists().find((l) => l.id === list.id) ?? list;
    return NextResponse.json({ list: fresh, failed }, { status: 201 });
  } catch (err) {
    return errorResponse(err, "Failed to create list");
  }
}
