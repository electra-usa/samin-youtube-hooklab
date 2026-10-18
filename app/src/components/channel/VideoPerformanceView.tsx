"use client";

import { useRouter } from "next/navigation";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { formatDate } from "@/lib/format";
import type { MyChannelVideo, VideoChange } from "@/lib/channel/videos";
import { useIsDark } from "./useIsDark";

type Point = { date: string; views: number; capturedAt: string };

const exact = (n: number) => new Intl.NumberFormat("en-US").format(n);
/** Same rounding as the original ("46K", "6.8K"). */
const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", compactDisplay: "short" }).format(n);

function ChartTooltip({ active, payload }: TooltipContentProps) {
  const point = payload?.[0]?.payload as Point | undefined;
  if (!active || !point) return null;
  return (
    <div className="rounded-lg border border-stroke bg-white px-3 py-2 text-xs shadow-lg dark:border-white/10 dark:bg-[#1b1c1f]">
      <p className="font-medium text-dark dark:text-white">{formatDate(point.capturedAt)}</p>
      <p className="mt-0.5 text-[var(--color-muted)]">{exact(point.views)} views</p>
    </div>
  );
}

/** Video Performance: total views and the daily view history from sync snapshots. */
export function VideoPerformanceView({ video, history, changes }: { video: MyChannelVideo; history: Point[]; changes: VideoChange[] }) {
  const router = useRouter();
  const dark = useIsDark();
  const axis = dark ? "#6b7280" : "#9ca3af";
  const grid = dark ? "#2e3035" : "#e5e7eb";

  const back = () => {
    if (window.history.length > 1) router.back();
    else router.push("/my-channel");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button type="button" onClick={back} className="text-primary hover:underline dark:text-sky-300">
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-dark dark:text-white">Video Performance</h1>
      </div>

      <div className="rounded-xl border border-stroke bg-white p-6 dark:border-white/10 dark:bg-[#18191c]">
        <h2 className="font-roboto text-lg font-medium text-dark dark:text-white">{video.title}</h2>
        <p className="font-roboto mt-1 text-sm text-[var(--color-muted)]">Total Views: {compact(video.views)}</p>
        <a
          href={video.videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-sm text-primary hover:underline dark:text-sky-300"
        >
          View on YouTube →
        </a>
      </div>

      <div className="rounded-xl border border-stroke bg-white p-6 dark:border-white/10 dark:bg-[#18191c]">
        <h3 className="mb-4 text-lg font-medium text-dark dark:text-white">Views Over Time</h3>
        {history.length ? (
          <div className="h-[400px] w-full" role="img" aria-label={`Views over time for ${video.title}`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} />
                <XAxis dataKey="date" stroke={axis} tick={{ fill: axis, fontSize: 12 }} tickMargin={4} />
                <YAxis stroke={axis} width={60} tick={{ fill: axis, fontSize: 12 }} tickFormatter={(v: number) => compact(v)} />
                <Tooltip content={ChartTooltip} cursor={{ stroke: axis, strokeDasharray: "3 3" }} />
                <Line
                  type="monotone"
                  dataKey="views"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={{ r: 4, fill: "#2563eb", stroke: dark ? "#18191c" : "#ffffff", strokeWidth: 2 }}
                  activeDot={{ r: 6 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="py-12 text-center text-sm text-[var(--color-muted)]">No view history yet. Sync your channel to start tracking.</p>
        )}
        <table className="sr-only">
          <caption>Daily views</caption>
          <thead>
            <tr>
              <th>Date</th>
              <th>Views</th>
            </tr>
          </thead>
          <tbody>
            {history.map((p) => (
              <tr key={p.date}>
                <td>{p.date}</td>
                <td>{p.views}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {changes.length > 0 && (
        <div className="rounded-xl border border-stroke bg-white p-6 dark:border-white/10 dark:bg-[#18191c]">
          <h3 className="mb-4 text-lg font-medium text-dark dark:text-white">Title changes</h3>
          <ol className="space-y-4">
            {changes.map((c) => (
              <li key={c.id} className="text-sm">
                <p className="text-xs text-[var(--color-muted)]">{formatDate(c.changedAt)}</p>
                <p className="font-roboto mt-1 text-[var(--color-muted)] line-through">{c.oldTitle}</p>
                <p className="font-roboto text-dark dark:text-white">{c.newTitle}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
