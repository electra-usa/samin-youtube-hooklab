import "server-only";
import { activeChannel, listUserChannels, type UserChannel } from "@/lib/db/app";

/** The requested user channel, or the active one. */
export function resolveUserChannel(userChannelId?: string | null): UserChannel | null {
  if (userChannelId) return listUserChannels().find((c) => c.id === userChannelId) ?? null;
  return activeChannel();
}

export const noChannelResponse = () =>
  Response.json({ success: false, error: "Add a channel to view your videos here." }, { status: 404 });
