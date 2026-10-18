// Display formatting that mirrors the original UI ("97K views · a day ago", "44.5M subs", "2.9x").

export function formatCount(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "0";
  const abs = Math.abs(n);
  const fmt = (v: number, suffix: string) => {
    const s = v >= 100 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, "");
    return `${s}${suffix}`;
  };
  if (abs >= 1_000_000_000) return fmt(n / 1_000_000_000, "B");
  if (abs >= 1_000_000) return fmt(n / 1_000_000, "M");
  if (abs >= 1_000) return fmt(n / 1_000, "K");
  return Math.round(n).toString();
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact" });

/** View counts use Intl compact notation like the original ("97K views", "6.8K views", "1.1M views"). */
export function formatViews(n: number | null | undefined): string {
  return `${compact.format(n ?? 0)} views`;
}

export function formatSubs(n: number | null | undefined): string {
  return `${formatCount(n)} subs`;
}

export function formatOutlier(score: number | null | undefined): string {
  if (score == null || Number.isNaN(score)) return "–";
  if (score >= 100) return `${Math.round(score)}x`;
  return `${score.toFixed(1)}x`;
}

/** "a day ago", "3 days ago", "a month ago", "5 months ago" (moment-style, as in the original). */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.round((now - then) / 1000));
  const m = s / 60;
  const h = m / 60;
  const d = h / 24;
  if (s < 45) return "a few seconds ago";
  if (m < 1.5) return "a minute ago";
  if (m < 45) return `${Math.round(m)} minutes ago`;
  if (h < 1.5) return "an hour ago";
  if (h < 22) return `${Math.round(h)} hours ago`;
  if (d < 1.5) return "a day ago";
  if (d < 26) return `${Math.round(d)} days ago`;
  if (d < 45) return "a month ago";
  if (d < 320) return `${Math.round(d / 30.4)} months ago`;
  if (d < 548) return "a year ago";
  return `${Math.round(d / 365)} years ago`;
}

export function formatDuration(totalSeconds: number | null | undefined): string {
  if (!totalSeconds || totalSeconds < 0) return "";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const pad = (v: number) => v.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Parse an ISO-8601 duration like PT18M35S into seconds. */
export function parseIsoDuration(iso: string | null | undefined): number {
  if (!iso) return 0;
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
  if (!m) return 0;
  const [, d, h, min, s] = m.map((v) => (v ? Number(v) : 0));
  return d * 86400 + h * 3600 + min * 60 + s;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
}

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function youtubeThumb(videoId: string, quality: "hqdefault" | "mqdefault" | "maxresdefault" = "hqdefault") {
  return `https://i.ytimg.com/vi/${videoId}/${quality}.jpg`;
}

export function youtubeUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
