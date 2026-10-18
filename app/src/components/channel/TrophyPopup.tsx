"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { getJson, sendJson } from "@/lib/api-client";
import { toast } from "@/components/ui/Toaster";
import { exactViews, type Trophy } from "@/lib/channel/trophy-format";
import { CHANNEL_SWITCHED } from "@/lib/client-events";
import { TROPHY_REFRESH } from "./events";
import { TrophyArtwork } from "./TrophyArtwork";
import { downloadTrophyCard, trophyHeadline } from "./trophy-share";

/** "New Trophy" celebration for trophies the latest sync awarded (marks them seen on close). */
export function TrophyPopup() {
  const router = useRouter();
  const [trophies, setTrophies] = useState<Trophy[]>([]);
  const [downloading, setDownloading] = useState(false);
  const shown = useRef(new Set<string>());

  const check = useCallback(async () => {
    const res = await getJson<{ data: { trophies: Trophy[] } }>("/api/my-channel/trophies/unseen", { cache: "no-store" }).catch(() => null);
    const fresh = (res?.data.trophies ?? []).filter((t) => !shown.current.has(t.id));
    if (!fresh.length) return;
    fresh.forEach((t) => shown.current.add(t.id));
    setTrophies(fresh);
  }, []);

  useEffect(() => {
    const first = setTimeout(check, 0);
    const onRefresh = () => void check();
    window.addEventListener(TROPHY_REFRESH, onRefresh);
    window.addEventListener(CHANNEL_SWITCHED, onRefresh);
    return () => {
      clearTimeout(first);
      window.removeEventListener(TROPHY_REFRESH, onRefresh);
      window.removeEventListener(CHANNEL_SWITCHED, onRefresh);
    };
  }, [check]);

  const dismiss = useCallback(
    (then?: () => void) => {
      const ids = trophies.map((t) => t.id);
      setTrophies([]);
      if (ids.length) void sendJson("/api/my-channel/trophies/unseen", "POST", { ids }).catch(() => {});
      then?.();
    },
    [trophies],
  );

  useEffect(() => {
    if (!trophies.length) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismiss();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [trophies.length, dismiss]);

  const trophy = trophies[0];
  if (!trophy) return null;
  const views = trophy.viewsAtAward ?? trophy.currentViews;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-4 dark:bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trophy-popup-title"
      onMouseDown={(e) => e.target === e.currentTarget && dismiss()}
    >
      <div className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-stroke bg-white shadow-2xl dark:border-white/10 dark:bg-[#18191c]">
        <button
          type="button"
          onClick={() => dismiss()}
          aria-label="Close trophy popup"
          className="absolute right-4 top-4 z-20 flex size-10 items-center justify-center rounded-full bg-white/90 text-dark-5 shadow-sm transition hover:bg-gray-100 hover:text-dark dark:bg-black/60 dark:text-gray-300 dark:hover:text-white"
        >
          <X className="size-5" />
        </button>
        <div className="absolute left-4 top-4 z-20 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm">New Trophy</div>
        <TrophyArtwork milestone={trophy.milestone} title={trophy.title} size="hero" className="rounded-b-none rounded-t-3xl border-0" />
        <div className="space-y-5 p-5 sm:p-6">
          <h2 id="trophy-popup-title" className="text-center text-xl font-bold text-dark dark:text-white sm:text-2xl">
            {trophyHeadline(trophy)}
          </h2>
          <div className="flex items-center gap-3 rounded-2xl bg-gray-50 p-3 dark:bg-white/5">
            <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-xl bg-[#e5e9ea] dark:bg-dark-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {trophy.videoThumbnail && <img src={trophy.videoThumbnail} alt="" className="absolute inset-0 h-full w-full object-cover" />}
            </div>
            <div className="min-w-0">
              <p className="line-clamp-2 text-sm font-semibold text-dark dark:text-white">{trophy.videoTitle}</p>
              <p className="mt-1 text-sm text-[var(--color-muted)]">{views != null ? `${exactViews(views)} views` : "New channel record"}</p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 sm:items-center">
            <button
              type="button"
              disabled={downloading}
              onClick={async () => {
                setDownloading(true);
                try {
                  await downloadTrophyCard(trophy, trophy.channelName ?? "");
                  toast.success("Trophy card downloaded");
                } catch {
                  toast.error("Failed to download trophy card");
                } finally {
                  setDownloading(false);
                }
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white transition hover:bg-primary-hover disabled:opacity-50"
            >
              <Download className="size-4" />
              {downloading ? "Downloading..." : "Download"}
            </button>
            <button
              type="button"
              onClick={() => dismiss(() => router.push("/my-channel/trophy-case"))}
              className="inline-flex w-full items-center justify-center rounded-lg border border-stroke bg-white px-4 py-2.5 text-sm font-medium text-dark transition hover:bg-gray-100 dark:border-white/15 dark:bg-transparent dark:text-white dark:hover:bg-white/10"
            >
              View Trophy Case
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
