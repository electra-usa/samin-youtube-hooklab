import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Transcripts and comments through yt-dlp (no API key needed). Extra flags such as
// --cookies-from-browser can be supplied with HOOKLAB_YTDLP_ARGS when YouTube rate-limits.

const YTDLP = process.env.HOOKLAB_YTDLP?.trim() || "/opt/homebrew/bin/yt-dlp";
const EXTRA_ARGS = (process.env.HOOKLAB_YTDLP_ARGS ?? "").split(/\s+/).filter(Boolean);

export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const url = new URL(s.startsWith("http") ? s : `https://${s}`);
    const host = url.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return url.pathname.slice(1, 12) || null;
    if (host.endsWith("youtube.com")) {
      const v = url.searchParams.get("v");
      if (v) return v.slice(0, 11);
      const m = url.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch {
    return null;
  }
  return null;
}

function run(args: string[], timeoutMs: number): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    execFile(YTDLP, [...EXTRA_ARGS, ...args], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, _stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException).code === "number" ? Number((err as NodeJS.ErrnoException).code) : 1) : 0;
      resolve({ code, stderr: String(stderr ?? "") });
    });
  });
}

/** Plain text from WebVTT or SRT, with YouTube's rolling auto-caption duplicates removed. */
export function subtitleToText(raw: string): string {
  const lines: string[] = [];
  for (const block of raw.replace(/\r/g, "").split(/\n\n+/)) {
    for (const line of block.split("\n")) {
      const t = line.trim();
      if (!t || t === "WEBVTT" || /^(Kind|Language|NOTE|STYLE|Region):?/.test(t) || /^\d+$/.test(t) || t.includes("-->")) continue;
      const clean = t
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (clean && clean !== lines[lines.length - 1]) lines.push(clean);
    }
  }
  // Group caption lines into readable paragraphs.
  const paragraphs: string[] = [];
  for (let i = 0; i < lines.length; i += 10) paragraphs.push(lines.slice(i, i + 10).join(" "));
  return paragraphs.join("\n\n").trim();
}

export type VideoTranscript = { videoId: string; title: string | null; channel: string | null; durationSeconds: number | null; text: string };

export async function fetchTranscript(input: string): Promise<VideoTranscript> {
  const videoId = parseYouTubeId(input);
  if (!videoId) throw new Error("That doesn't look like a YouTube video URL.");
  if (!fs.existsSync(YTDLP)) throw new Error("yt-dlp isn't installed, so transcripts can't be fetched. Paste the transcript instead.");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hooklab-yt-"));
  try {
    const { stderr } = await run(
      [
        "-i", "--skip-download", "--no-simulate", "--no-warnings", "--no-progress",
        "--write-subs", "--write-auto-subs", "--sub-langs", "en,en-orig,.*-orig", "--sub-format", "vtt/srt/best",
        "--print-to-file", "%(title)s\t%(channel)s\t%(duration)s", path.join(dir, "meta.tsv"),
        "-o", path.join(dir, "sub.%(ext)s"),
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      90_000,
    );
    const files = fs.readdirSync(dir).filter((f) => /\.(vtt|srt)$/.test(f));
    const rank = (f: string) => (/\.en\.(vtt|srt)$/.test(f) ? 0 : /\.en-orig\./.test(f) ? 1 : /\.en/.test(f) ? 2 : 3);
    const best = files.sort((a, b) => rank(a) - rank(b))[0];
    const [title, channel, duration] = (fs.existsSync(path.join(dir, "meta.tsv")) ? fs.readFileSync(path.join(dir, "meta.tsv"), "utf8") : "")
      .split("\n")[0]
      .split("\t");
    if (!best) {
      if (/429|too many requests/i.test(stderr)) throw new Error("YouTube is rate-limiting transcript downloads right now. Try again in a few minutes, or paste the transcript.");
      if (/private|unavailable|not exist/i.test(stderr)) throw new Error("That video is private or unavailable.");
      throw new Error("This video has no captions to pull a transcript from. Paste the transcript instead.");
    }
    const text = subtitleToText(fs.readFileSync(path.join(dir, best), "utf8"));
    if (!text) throw new Error("The captions for this video were empty. Paste the transcript instead.");
    return {
      videoId,
      title: title?.trim() || null,
      channel: channel?.trim() || null,
      durationSeconds: duration && Number.isFinite(Number(duration)) ? Number(duration) : null,
      text,
    };
  } finally {
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }
}

export type VideoComment = { text: string; likes: number; author: string | null; isCreator: boolean };

/** Top comments for a video (best effort: returns [] when yt-dlp can't get them). */
export async function fetchComments(videoId: string, max = 40): Promise<VideoComment[]> {
  if (!fs.existsSync(YTDLP)) return [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hooklab-yt-"));
  try {
    await run(
      [
        "-i", "--skip-download", "--write-comments", "--write-info-json", "--no-warnings", "--no-progress",
        "--extractor-args", `youtube:max_comments=${max},all,0;comment_sort=top`,
        "-o", path.join(dir, "v.%(ext)s"),
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      45_000,
    );
    const file = path.join(dir, "v.info.json");
    if (!fs.existsSync(file)) return [];
    const info = JSON.parse(fs.readFileSync(file, "utf8")) as {
      channel_id?: string;
      comments?: { text?: string; like_count?: number; author?: string; author_id?: string }[];
    };
    return (info.comments ?? [])
      .filter((c) => c.text?.trim())
      .map((c) => ({
        text: c.text!.trim().slice(0, 600),
        likes: c.like_count ?? 0,
        author: c.author ?? null,
        isCreator: !!info.channel_id && c.author_id === info.channel_id,
      }));
  } catch {
    return [];
  } finally {
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }
}
