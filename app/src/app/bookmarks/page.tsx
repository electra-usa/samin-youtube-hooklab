import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { GridSkeleton } from "@/components/outliers/controls";
import { BookmarksView } from "@/components/bookmarks/BookmarksView";
import { followedChannelIds, listFollowingLists } from "@/lib/research/following";

export const metadata: Metadata = { title: "Bookmarks" };

export default async function BookmarksPage() {
  await connection();
  const lists = listFollowingLists().map((l) => ({ id: l.id, name: l.name, channelIds: l.channelIds }));
  return (
    <Suspense fallback={<GridSkeleton />}>
      <BookmarksView initialLists={lists} initialFollowedChannelIds={followedChannelIds()} />
    </Suspense>
  );
}
