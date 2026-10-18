// Polite HTTP for keyless YouTube endpoints: timeouts, a couple of retries with jittered
// backoff on 429/5xx, and a shared cool-down once YouTube starts answering 429.
import { sleep } from "./util.ts";

export const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  // Skips the EU consent interstitial on channel and watch pages.
  Cookie: "CONSENT=YES+1; SOCS=CAI",
};

export type GetResult = { status: number; text: string | null; error?: string };

let coolDownUntil = 0;
let consecutive429 = 0;
let requestCount = 0;

/** Requests sent by this process (for run stats). */
export const requestsSent = () => requestCount;

/** True after repeated 429s: callers should stop issuing new requests for this run. */
export const rateLimited = () => consecutive429 >= 4;

export function resetRateLimit(): void {
  consecutive429 = 0;
  coolDownUntil = 0;
}

const backoff = (attempt: number) => 1_000 * 2 ** attempt + Math.random() * 500;

export async function politeGet(
  url: string,
  { timeoutMs = 12_000, retries = 2, headers, signal }: { timeoutMs?: number; retries?: number; headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<GetResult> {
  for (let attempt = 0; ; attempt++) {
    const wait = coolDownUntil - Date.now();
    if (wait > 0) await sleep(wait, signal);
    if (signal?.aborted) return { status: 0, text: null, error: "aborted" };
    requestCount++;
    try {
      const timeout = AbortSignal.timeout(timeoutMs);
      const res = await fetch(url, {
        headers: { ...BROWSER_HEADERS, ...headers },
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
        redirect: "follow",
      });
      if (res.status === 429) {
        consecutive429++;
        coolDownUntil = Date.now() + Math.min(120_000, 5_000 * 2 ** consecutive429);
      }
      if ((res.status === 429 || res.status >= 500) && attempt < retries && !rateLimited()) {
        await res.body?.cancel().catch(() => {});
        await sleep(backoff(attempt), signal);
        continue;
      }
      if (res.status !== 429) consecutive429 = 0;
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return { status: res.status, text: null, error: `HTTP ${res.status}` };
      }
      return { status: res.status, text: await res.text() };
    } catch (err) {
      if (signal?.aborted) return { status: 0, text: null, error: "aborted" };
      if (attempt < retries) {
        await sleep(backoff(attempt), signal);
        continue;
      }
      const message = err instanceof Error ? (err.name === "TimeoutError" ? "timed out" : err.message) : String(err);
      return { status: 0, text: null, error: message };
    }
  }
}
