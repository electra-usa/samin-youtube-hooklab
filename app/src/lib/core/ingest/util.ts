// Small helpers shared by the ingest modules.

export const nowIso = () => new Date().toISOString();

export const hoursAgoIso = (hours: number, from = Date.now()) => new Date(from - hours * 3_600_000).toISOString();

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** Run `fn` over items with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const CHANNEL_ID_RE = /^UC[\w-]{22}$/;

/** ISO 8601 duration the way the library stores it: PT1H2M3S, zero parts omitted ("PT25M"). */
export function isoDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (!h && !m && !sec) return "PT0S";
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${sec ? `${sec}S` : ""}`;
}

export function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** "21.4M subscribers" -> 21400000, "1.17 million" -> 1170000, "12,345" -> 12345. */
export function parseCount(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /([\d.,]+)\s*([KMB]|thousand|million|billion)?/i.exec(text.replace(/ /g, " "));
  if (!m) return null;
  const unit = (m[2] ?? "").toLowerCase();
  const raw = unit ? m[1].replace(/,/g, "") : m[1].replace(/[.,]/g, "");
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const mult = unit.startsWith("k") || unit === "thousand" ? 1e3 : unit.startsWith("m") ? 1e6 : unit.startsWith("b") ? 1e9 : 1;
  return Math.round(n * mult);
}
