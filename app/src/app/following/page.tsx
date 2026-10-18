import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { GridSkeleton } from "@/components/outliers/controls";
import { FollowingView } from "@/components/following/FollowingView";
import { followedChannelIds, listFollowingLists, syncStatus } from "@/lib/research/following";

export const metadata: Metadata = { title: "Following" };

export default async function FollowingPage() {
  await connection();
  const lists = listFollowingLists().map((l) => ({ id: l.id, name: l.name, channelIds: l.channelIds }));
  return (
    <Suspense fallback={<GridSkeleton />}>
      <FollowingView initialLists={lists} initialFollowedChannelIds={followedChannelIds()} initialSyncedAt={syncStatus().lastSyncedAt} />
    </Suspense>
  );
}
