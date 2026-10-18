import "server-only";
import { activeGeneration, getGeneration, setGenerationStatus } from "./store";
import type { ActiveGeneration } from "./types";

// In-flight generations of this server process, keyed by generationId. Kept on globalThis so
// every route module (stream, cancel) shares one map even when bundled separately.
type Live = { controller: AbortController; chatId: string; startedAt: number };

const g = globalThis as unknown as { __hooklabLiveGenerations?: Map<string, Live> };
const live = (g.__hooklabLiveGenerations ??= new Map<string, Live>());

export function registerGeneration(id: string, chatId: string): AbortController {
  const controller = new AbortController();
  live.set(id, { controller, chatId, startedAt: Date.now() });
  return controller;
}

export function unregisterGeneration(id: string) {
  live.delete(id);
}

export function isChatGenerating(chatId: string): boolean {
  for (const entry of live.values()) if (entry.chatId === chatId) return true;
  return false;
}

/** The chat's running generation; rows left "running" by a restarted server are closed out. */
export function liveActiveGeneration(chatId: string): ActiveGeneration | null {
  const row = activeGeneration(chatId);
  if (!row) return null;
  if (live.has(row.id)) return row;
  setGenerationStatus(row.id, "failed", "server_restarted");
  return null;
}

/** Stop a generation; the pipeline keeps whatever was already streamed. */
export function cancelGeneration(id: string, reason = "user_cancelled"): "cancelled" | "not_running" | "unknown" {
  const entry = live.get(id);
  if (entry) {
    setGenerationStatus(id, "cancel_requested", reason);
    entry.controller.abort(reason);
    return "cancelled";
  }
  const row = getGeneration(id);
  if (!row) return "unknown";
  if (row.status === "running" || row.status === "cancel_requested") {
    // Orphaned by a restart (no live controller): close it out.
    setGenerationStatus(id, "cancelled", reason);
    return "cancelled";
  }
  return "not_running";
}

/** Cross-check the database in case a cancel arrived through another process. */
export function cancelRequested(id: string): boolean {
  return getGeneration(id)?.status === "cancel_requested";
}
