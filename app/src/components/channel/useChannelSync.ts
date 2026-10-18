"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getJson, sendJson } from "@/lib/api-client";
import { toast } from "@/components/ui/Toaster";
import { emitTrophyRefresh } from "./events";

export type SyncState = "idle" | "queued" | "running" | "completed" | "failed";

type SyncStatus = {
  state: SyncState;
  detail: string | null;
  lastSyncedAt: string | null;
  runId: string | null;
  finishedAt: string | null;
  error: string | null;
  stats: { videos: number; newVideos: number } | null;
};

const DAY_MS = 86_400_000;
const POLL_MS = 5_000;

/**
 * Channel sync state for My Channel: polls /api/my-channel/sync-status every 5 s
 * (as the original does), kicks off a sync when the last one is over a day old,
 * and calls onCompleted once per finished run.
 */
export function useChannelSync({
  userChannelId,
  lastSyncedAt,
  renderedAt,
  onCompleted,
}: {
  userChannelId: string;
  lastSyncedAt: string | null;
  renderedAt: string;
  onCompleted: () => void;
}) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [progress, setProgress] = useState(0);
  const handledRun = useRef<string | null>(null);
  const manualRun = useRef<string | null>(null);
  const autoStarted = useRef<string | null>(null);
  const completedRef = useRef(onCompleted);
  useEffect(() => {
    completedRef.current = onCompleted;
  }, [onCompleted]);

  const poll = useCallback(async () => {
    const s = await getJson<SyncStatus>(`/api/my-channel/sync-status?userChannelId=${encodeURIComponent(userChannelId)}`, {
      cache: "no-store",
    }).catch(() => null);
    if (!s) return;
    setStatus(s);
    if (s.state === "completed" && s.runId && handledRun.current !== s.runId) {
      handledRun.current = s.runId;
      const finishedAfterRender = !!s.finishedAt && s.finishedAt > renderedAt;
      if (finishedAfterRender || manualRun.current === s.runId) {
        completedRef.current();
        emitTrophyRefresh();
      }
      if (manualRun.current === s.runId) {
        manualRun.current = null;
        toast.success(s.detail ?? "Channel synced");
      }
    }
  }, [userChannelId, renderedAt]);

  useEffect(() => {
    // The first tick runs on a timer so state isn't set synchronously inside the effect.
    const first = setTimeout(poll, 0);
    const timer = setInterval(poll, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [poll]);

  const start = useCallback(
    async ({ manual = false, ifStale = false }: { manual?: boolean; ifStale?: boolean } = {}) => {
      setStarting(true);
      try {
        const res = await sendJson<{ success: boolean; queued?: boolean; skipped?: boolean; runId?: string; error?: string }>(
          "/api/my-channel/sync",
          "POST",
          { userChannelId, ifStale },
        );
        if (res.queued && res.runId) {
          if (manual) manualRun.current = res.runId;
          setStatus((s) => ({
            state: "queued",
            detail: "Waiting to start…",
            lastSyncedAt: s?.lastSyncedAt ?? lastSyncedAt,
            runId: res.runId ?? null,
            finishedAt: null,
            error: null,
            stats: null,
          }));
          setTimeout(poll, 1_500);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to start sync");
      } finally {
        setStarting(false);
      }
    },
    [userChannelId, lastSyncedAt, poll],
  );

  // Daily refresh on visit, like the original's ensureChannelVideosSynced.
  useEffect(() => {
    if (autoStarted.current === userChannelId) return;
    autoStarted.current = userChannelId;
    const stale = !lastSyncedAt || Date.now() - Date.parse(lastSyncedAt) > DAY_MS;
    if (!stale) return;
    const t = setTimeout(() => void start({ ifStale: true }), 0);
    return () => clearTimeout(t);
  }, [userChannelId, lastSyncedAt, start]);

  const syncing = starting || status?.state === "queued" || status?.state === "running";

  // Same easing as the original's "Estimated progress" bar.
  useEffect(() => {
    if (!syncing) {
      const reset = setTimeout(() => setProgress(0), 0);
      return () => clearTimeout(reset);
    }
    const kick = setTimeout(() => setProgress((p) => (p === 0 ? 8 : p)), 0);
    const timer = setInterval(() => setProgress((p) => Math.min(92, p + Math.max(2, Math.floor((92 - p) * 0.12)))), 1_200);
    return () => {
      clearTimeout(kick);
      clearInterval(timer);
    };
  }, [syncing]);

  return {
    state: status?.state ?? "idle",
    detail: status?.detail ?? null,
    error: status?.error ?? null,
    lastSyncedAt: status?.lastSyncedAt ?? lastSyncedAt,
    syncing,
    progress,
    start,
  };
}
