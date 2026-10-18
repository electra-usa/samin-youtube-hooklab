"use client";

import { useCallback, useSyncExternalStore } from "react";
import { PageFrame } from "@/components/shell/AppShell";
import { Tabs } from "@/components/ui/Tabs";
import type { UserChannel } from "@/lib/db/app";
import type { BillingSummary } from "@/lib/billing/plans";
import type { TeamState } from "@/lib/billing/team";
import { SETTINGS_TABS, isSettingsTab, type SettingsTab } from "./shared";
import { ProfileTab } from "./ProfileTab";
import { ChannelsTab } from "./ChannelsTab";
import { BillingTab } from "./BillingTab";
import { TeamsTab } from "./TeamsTab";

export type SettingsInitialData = {
  user: { name: string; email: string };
  contentLanguages: string[];
  emailPreferences: { weeklyIdeasEmailOptIn: boolean; featuredChannelIds: string[] };
  channels: UserChannel[];
  billing: BillingSummary;
  team: TeamState;
};

// The tab lives in the URL hash (#profile, #channels, #billing, #teams), as in the original;
// `?tab=` (used by the sidebar's "Add channel") picks the tab when there is no hash.
const subscribeHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const readHash = () => window.location.hash.replace(/^#/, "").split("?")[0];

export function SettingsView({
  initialTab,
  openAddChannel = false,
  data,
}: {
  initialTab: SettingsTab;
  /** ?tab=channels&add=1 opens the Add Channel dialog right away. */
  openAddChannel?: boolean;
  data: SettingsInitialData;
}) {
  const hash = useSyncExternalStore(subscribeHash, readHash, () => "");
  const tab: SettingsTab = isSettingsTab(hash) ? hash : initialTab;

  const selectTab = useCallback((next: SettingsTab) => {
    window.history.pushState(null, "", `/settings#${next}`);
    // pushState doesn't fire hashchange; let the hash subscription know.
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, []);

  return (
    <div className="mx-auto w-full max-w-[1128px]">
      <PageFrame title="Settings" subtitle="Manage your profile, channels, billing, and team.">
        <Tabs tabs={SETTINGS_TABS} value={tab} onChange={selectTab} className="mb-6" />
        {tab === "profile" && (
          <ProfileTab
            user={data.user}
            contentLanguages={data.contentLanguages}
            emailPreferences={data.emailPreferences}
            channels={data.channels}
          />
        )}
        {tab === "channels" && (
          <ChannelsTab initialChannels={data.channels} maxChannels={data.billing.limits.maxChannels} startAdding={openAddChannel} />
        )}
        {tab === "billing" && <BillingTab initialSummary={data.billing} />}
        {tab === "teams" && <TeamsTab initialTeam={data.team} />}
      </PageFrame>
    </div>
  );
}
