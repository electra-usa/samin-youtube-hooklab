import { V1Error, v1Error, v1Handler, v1Json, v1Options } from "@/lib/api-v1/http";
import { RefreshBusyError, getRun, startRefresh, type RefreshOptions } from "@/lib/core/ingest/refresh";
import { summaryLine } from "@/lib/core/ingest/scheduler";
import type { TaggingMode } from "@/lib/core/ingest/settings";

// POST /api/v1/refresh {channels?, channelIds?, discover?, discoverQueries?, tagging?, dryRun?}
// Starts a refresh run in this server process and answers right away with the run (202);
// 409 while another run (CLI worker, scheduler or API) holds the lock. Poll
// GET /api/v1/refresh/status for progress. Also the cron entry point for hosted setups.

const intIn = (v: unknown, name: string, min: number, max: number): number | undefined => {
  if (v == null) return undefined;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) throw new V1Error(400, `${name} must be a whole number from ${min} to ${max}.`);
  return n;
};

const boolOf = (v: unknown, name: string): boolean | undefined => {
  if (v == null) return undefined;
  if (typeof v !== "boolean") throw new V1Error(400, `${name} must be true or false.`);
  return v;
};

export const POST = v1Handler(async (req: Request) => {
  const text = await req.text();
  let body: Record<string, unknown> = {};
  if (text.trim()) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      body = parsed as Record<string, unknown>;
    } catch {
      return v1Error(400, "invalid_json", "Send a JSON object, e.g. {\"channels\": 200, \"discover\": true}.");
    }
  }
  const channelIds = body.channelIds;
  if (channelIds != null && (!Array.isArray(channelIds) || !channelIds.every((c) => typeof c === "string" && /^UC[\w-]{22}$/.test(c)))) {
    throw new V1Error(400, "channelIds must be a list of UC… channel ids.");
  }
  const tagging = body.tagging;
  if (tagging != null && !["outliers", "all", "off"].includes(String(tagging))) throw new V1Error(400, "tagging must be outliers, all or off.");
  const opts: RefreshOptions = {
    channels: intIn(body.channels, "channels", 0, 5_000),
    channelIds: channelIds as string[] | undefined,
    concurrency: intIn(body.concurrency, "concurrency", 1, 16),
    discover: boolOf(body.discover, "discover"),
    discoverQueries: intIn(body.discoverQueries, "discoverQueries", 1, 20),
    tagging: tagging as TaggingMode | undefined,
    dryRun: boolOf(body.dryRun, "dryRun"),
    trigger: "api",
    log: (m) => console.log(`[hooklab refresh] ${m}`),
  };
  try {
    const { run, done } = startRefresh(opts);
    done.then(
      (summary) => console.log(`[hooklab refresh] ${summaryLine(summary)}`),
      (err) => console.error("[hooklab refresh] run failed", err),
    );
    return v1Json({ run, status: `/api/v1/refresh/status` }, { status: 202 });
  } catch (err) {
    if (err instanceof RefreshBusyError) {
      const current = err.lock?.runId ? getRun(err.lock.runId) : null;
      return v1Json({ error: { code: "refresh_running", message: err.message }, run: current }, { status: 409 });
    }
    throw err;
  }
});

export const OPTIONS = v1Options;
