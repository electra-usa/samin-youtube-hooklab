import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { PageFrame } from "@/components/shell/AppShell";
import { GridSkeleton } from "@/components/outliers/controls";
import { OutliersView } from "@/components/outliers/OutliersView";
import { getOutliersPreferences } from "@/lib/research/app-data";
import { followedChannelIds, listFollowingLists } from "@/lib/research/following";

export const metadata: Metadata = { title: "Outliers" };

export default async function OutliersPage() {
  await connection();
  const prefs = getOutliersPreferences();
  const lists = listFollowingLists().map((l) => ({ id: l.id, name: l.name, channelIds: l.channelIds }));
  return (
    <PageFrame title="Outliers">
      <Suspense fallback={<GridSkeleton />}>
        <OutliersView
          initialDefaults={prefs.outliersDefaultFilters}
          initialHiddenChannels={prefs.hiddenChannels}
          initialLists={lists}
          initialFollowedChannelIds={followedChannelIds()}
        />
      </Suspense>
    </PageFrame>
  );
}
