import { NextResponse } from "next/server";
import { activeChannel, currentUser, getSetting, listUserChannels } from "@/lib/db/app";

export async function GET() {
  const user = currentUser();
  const channels = listUserChannels();
  return NextResponse.json({
    user: { name: user?.name ?? null, email: user?.email ?? null, image: user?.image ?? null },
    channels,
    activeChannelId: activeChannel()?.id ?? null,
    theme: getSetting<"light" | "dark">("theme", "light"),
  });
}
