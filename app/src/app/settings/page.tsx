import type { Metadata } from "next";
import { connection } from "next/server";
import { currentUser, listUserChannels } from "@/lib/db/app";
import { billingSummary } from "@/lib/billing/ledger";
import { getTeam } from "@/lib/billing/team";
import { getContentLanguages, getEmailPreferences } from "@/app/api/user/_lib/account";
import { SettingsView } from "@/components/settings/SettingsView";
import { isSettingsTab } from "@/components/settings/shared";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const { tab, add } = await searchParams;
  const user = currentUser();
  return (
    <SettingsView
      initialTab={isSettingsTab(tab) ? tab : "profile"}
      openAddChannel={tab === "channels" && add === "1"}
      data={{
        user: { name: user?.name ?? "", email: user?.email ?? "" },
        contentLanguages: getContentLanguages().selectedContentLanguages,
        emailPreferences: getEmailPreferences(),
        channels: listUserChannels(),
        billing: billingSummary(),
        team: getTeam(),
      }}
    />
  );
}
