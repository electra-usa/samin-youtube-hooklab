import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PageFrame } from "@/components/shell/AppShell";
import { VideoPerformanceView } from "@/components/channel/VideoPerformanceView";
import { getChangeHistory, getChannelVideo, getViewHistory } from "@/lib/channel/videos";

export const metadata: Metadata = { title: "Video Performance" };

export default async function VideoPerformancePage(props: PageProps<"/my-channel/[videoId]">) {
  await connection();
  const { videoId } = await props.params;
  const video = getChannelVideo(videoId);
  return (
    <PageFrame>
      <div className="mx-auto w-full max-w-[1080px]">
        {video ? (
          <VideoPerformanceView video={video} history={getViewHistory(videoId)} changes={getChangeHistory(videoId)} />
        ) : (
          <div className="space-y-4">
            <Link href="/my-channel" className="text-primary hover:underline dark:text-sky-300">
              ← Back
            </Link>
            <div className="rounded-xl border border-stroke bg-white p-6 text-sm text-[var(--color-muted)] dark:border-white/10 dark:bg-[#18191c]">
              This video isn&apos;t in your synced channel videos.
            </div>
          </div>
        )}
      </div>
    </PageFrame>
  );
}
