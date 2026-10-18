import type { Metadata } from "next";
import { connection } from "next/server";
import { PageFrame } from "@/components/shell/AppShell";
import { MyChannelView } from "@/components/channel/MyChannelView";
import { MyChannelEmptyState } from "@/components/channel/MyChannelEmptyState";
import { activeChannel } from "@/lib/db/app";
import { getChannelSummary } from "@/lib/channel/videos";

export const metadata: Metadata = { title: "My Channel" };

export default async function MyChannelPage() {
  await connection();
  const channel = activeChannel();
  return (
    <PageFrame>
      <div className="mx-auto w-full max-w-[1800px]">
        {channel ? (
          <MyChannelView key={channel.id} channel={getChannelSummary(channel)} renderedAt={new Date().toISOString()} />
        ) : (
          <MyChannelEmptyState />
        )}
      </div>
    </PageFrame>
  );
}
