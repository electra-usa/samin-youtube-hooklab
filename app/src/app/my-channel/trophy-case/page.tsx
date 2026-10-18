import type { Metadata } from "next";
import { connection } from "next/server";
import { PageFrame } from "@/components/shell/AppShell";
import { TrophyCaseView } from "@/components/channel/TrophyCaseView";
import { MyChannelEmptyState } from "@/components/channel/MyChannelEmptyState";
import { activeChannel } from "@/lib/db/app";
import { getChannelSummary } from "@/lib/channel/videos";
import { getNextTargets, getTrophyEligibility, listTrophies } from "@/lib/channel/trophies";

export const metadata: Metadata = { title: "Trophy Case" };

export default async function TrophyCasePage() {
  await connection();
  const channel = activeChannel();
  return (
    <PageFrame>
      {channel ? (
        <TrophyCaseView
          key={channel.id}
          channel={getChannelSummary(channel)}
          trophies={listTrophies(channel.id)}
          nextTargets={getNextTargets(channel.id)}
          eligibility={getTrophyEligibility(channel.id)}
        />
      ) : (
        <MyChannelEmptyState />
      )}
    </PageFrame>
  );
}
