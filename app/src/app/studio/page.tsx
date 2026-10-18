import type { Metadata } from "next";
import { connection } from "next/server";
import { PageFrame } from "@/components/shell/AppShell";
import { StudioClient } from "@/components/studio/StudioClient";
import { activeChannel } from "@/lib/db/app";
import { getWorkspace } from "@/app/api/studio/_lib/store";

export const metadata: Metadata = { title: "Studio" };

// /studio?workspaceId=… opens a saved workspace; ?prefillTitle=…&videoId=… (also title / videoTitle)
// starts from a title and that video's thumbnail.
export default async function StudioPage(props: PageProps<"/studio">) {
  await connection();
  const query = await props.searchParams;
  const pick = (...keys: string[]) => {
    for (const [k, v] of Object.entries(query)) {
      if (!keys.some((key) => key.toLowerCase() === k.toLowerCase())) continue;
      const value = (Array.isArray(v) ? v[0] : v)?.trim();
      if (value) return value;
    }
    return null;
  };
  const workspaceId = pick("workspaceId");
  const workspace = workspaceId ? getWorkspace(workspaceId) : null;
  const videoId = pick("videoId");
  const channel = activeChannel();

  return (
    <PageFrame>
      <div className="mx-auto w-full max-w-[1400px]">
        <StudioClient
          channelName={channel?.name ?? "Your Channel"}
          channelAvatar={channel?.avatar ?? null}
          initialWorkspace={workspace}
          workspaceMissing={!!workspaceId && !workspace}
          prefillTitle={pick("prefillTitle", "title", "videoTitle")}
          prefillVideoId={videoId && /^[\w-]{11}$/.test(videoId) ? videoId : null}
          projectName={pick("projectName")}
        />
      </div>
    </PageFrame>
  );
}
