// Claude tags new live videos the way the library is tagged: one niche (of 45), 1-4 click
// triggers (of 48), a frame and a point of view. ~40 titles per structured-output request.
// Uses the chat's providers: the Anthropic SDK when credentials exist, else the signed-in
// Claude Code CLI. Model HOOKLAB_TAGGING_MODEL (default claude-opus-5-5), effort low.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { runAnthropic } from "../../ai/anthropic.ts";
import { runClaudeCode } from "../../ai/claude-code.ts";
import { resolveProvider } from "../../ai/config.ts";
import type { AiRequest, AiUsage } from "../../ai/types.ts";
import { libraryReader } from "./reader.ts";
import { dataDir } from "../paths.ts";
import { OUTLIER_THRESHOLD, type TaggingMode } from "./settings.ts";
import { errorMessage, nowIso } from "./util.ts";
import type { LibraryWriter } from "./writer.ts";

export const FRAMES = ["analysis", "tutorial", "story", "list", "experiment", "review", "reaction"];

type Taxonomy = { niches: string[]; clickTriggers: string[]; povs: string[] };
let taxonomy: Taxonomy | null = null;

/** src/lib/taxonomy.json, found from the Next.js app dir, this file's location or the data dir. */
export function loadTaxonomy(): Taxonomy {
  if (taxonomy) return taxonomy;
  const candidates: string[] = [];
  if (process.env.NEXT_RUNTIME) candidates.push(path.resolve(process.cwd(), "src/lib/taxonomy.json"));
  try {
    candidates.push(fileURLToPath(new URL("../../taxonomy.json", import.meta.url)));
  } catch {
    // not a file: URL inside a bundle
  }
  candidates.push(path.resolve(process.cwd(), "src/lib/taxonomy.json"), path.resolve(process.cwd(), "app/src/lib/taxonomy.json"), path.join(dataDir(), "taxonomy.json"));
  for (const file of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { niches?: string[]; click_triggers?: string[]; povs?: string[] };
      if (raw.niches?.length && raw.click_triggers?.length && raw.povs?.length) {
        taxonomy = { niches: raw.niches, clickTriggers: raw.click_triggers, povs: raw.povs };
        return taxonomy;
      }
    } catch {
      // try the next location
    }
  }
  throw new Error("taxonomy.json not found (expected app/src/lib/taxonomy.json)");
}

// Short working definitions so labels stay consistent between batches.
const TRIGGER_NOTES: Record<string, string> = {
  Authority: "credentials or expert status",
  Beginners: "aimed at newcomers",
  "Confirms Suspicions": "validates what viewers already suspected",
  Conflict: "people or sides in opposition",
  Conspiracy: "hidden plots, cover-ups",
  Constraint: "a self-imposed limit or rule ($0, one tool, 24 hours)",
  Contrast: "two very different things side by side",
  Controversy: "divisive or provocative stance",
  Counterintuitive: "goes against common belief",
  Curiosity: "withholds the key detail",
  Daily: "daily routines and habits",
  Desire: "promises something viewers want",
  Drama: "interpersonal turmoil, scandal",
  Epic: "grand scale, legendary, awe",
  Escape: "leaving it all behind, getaways",
  Experience: "a firsthand account (I tried, my experience)",
  Extreme: "the most, biggest, longest, priciest",
  Fear: "danger or threat",
  FOMO: "missing out on a trend or opportunity",
  Future: "predictions, what's coming",
  List: "a numbered list",
  Mistake: "errors to avoid",
  Moment: "one specific moment or event",
  Negativity: "negative framing (worst, never, bad)",
  New: "novelty, a new release or update",
  News: "current events",
  "Open Loop": "a story set up without its resolution",
  "Pain Point": "a problem the viewer has",
  Price: "money amounts and costs",
  Question: "phrased as a question",
  "Refute Objection": "removes a reason not to try (no experience, no money)",
  Regret: "something regretted",
  Scarcity: "rare, limited, few know",
  "SEO-Friendly": "searchable keyword phrasing (how to …)",
  Seasonality: "a season, holiday or time of year",
  Secret: "hidden knowledge revealed",
  "Social Proof": "popularity, how many people",
  "Specific Audience": "calls out a specific group",
  Speed: "fast results",
  Status: "prestige, luxury, rank",
  "Time Frame": "a specific span (in 30 days, by 2030)",
  Transformation: "a before/after change",
  Universal: "relatable to almost everyone",
  Urgency: "act now, time-sensitive",
  Warning: "caution against something",
  Weird: "strange, bizarre",
  "X vs. Y": "a direct comparison",
  Year: "names a year",
};

const POV_NOTES: Record<string, string> = {
  first_person_experience: "the creator's own story or experience (I, my, we)",
  first_person_teaching: "the creator teaching from their own expertise",
  second_person_direct: "addresses the viewer (you, your)",
  third_person_explanatory: "explains a subject from the outside",
  third_person_curation: "curates or ranks things or people",
};

function tagSchema(t: Taxonomy) {
  return z.object({
    videos: z.array(
      z.object({
        n: z.number().describe("The video's number from the list."),
        niche: z.enum(t.niches),
        clickTriggers: z.array(z.enum(t.clickTriggers)).describe("1-4 click triggers that make the title clickable, strongest first."),
        frame: z.enum(FRAMES),
        pov: z.enum(t.povs),
      }),
    ),
  });
}

/** Deterministic calibration examples from the exported library (keeps the system prompt cacheable). */
function libraryExamples(db: DatabaseSync, t: Taxonomy): string {
  const rows = db
    .prepare(
      `SELECT title, niches, click_triggers, frame, pov FROM videos
       WHERE id NOT LIKE 'rss:%' AND niches != '[]' AND click_triggers != '[]'
         AND frame IN (SELECT value FROM json_each(?)) AND pov IN (SELECT value FROM json_each(?))
       ORDER BY id LIMIT 24`,
    )
    .all(JSON.stringify(FRAMES), JSON.stringify(t.povs)) as { title: string; niches: string; click_triggers: string; frame: string; pov: string }[];
  return rows
    .map((r) => `- "${r.title}" → niche ${JSON.parse(r.niches)[0]}; triggers ${(JSON.parse(r.click_triggers) as string[]).join(", ")}; ${r.frame}; ${r.pov}`)
    .join("\n");
}

function systemPrompt(db: DatabaseSync, t: Taxonomy): string {
  return [
    "You label YouTube videos for an outlier research library, from the title and channel only.",
    "For each numbered video return:",
    `- niche: exactly one of: ${t.niches.join(" | ")}. When the channel's usual niches are given and fit, use them.`,
    "- clickTriggers: 1-4 of these (what makes the title clickable), strongest first:",
    ...t.clickTriggers.map((c) => `  - ${c}${TRIGGER_NOTES[c] ? `: ${TRIGGER_NOTES[c]}` : ""}`),
    `- frame: one of ${FRAMES.join(", ")} (analysis = explains or breaks down; experiment = challenge or test).`,
    "- pov:",
    ...t.povs.map((p) => `  - ${p}${POV_NOTES[p] ? `: ${POV_NOTES[p]}` : ""}`),
    "Return every video exactly once, keyed by its number. Examples from the library:",
    libraryExamples(db, t),
  ].join("\n");
}

type Target = { id: string; title: string; channelId: string | null; channelName: string | null; isShort: number };

function channelNiches(db: DatabaseSync, channelId: string | null): string[] {
  if (!channelId) return [];
  const rows = db
    .prepare("SELECT niches, count(*) AS n FROM videos WHERE channel_id = ? AND niches != '[]' GROUP BY niches ORDER BY n DESC LIMIT 3")
    .all(channelId) as { niches: string; n: number }[];
  const total = rows.reduce((s, r) => s + r.n, 0);
  return rows.filter((r) => r.n / total >= 0.2).flatMap((r) => JSON.parse(r.niches) as string[]);
}

function usageCost(u: AiUsage): number {
  if (u.costUsd != null && Number.isFinite(u.costUsd)) return u.costUsd;
  // claude-opus-5-5 list prices: $4 / $20 per million tokens.
  return (u.inputTokens * 4 + u.cacheCreationTokens * 5 + u.cacheReadTokens * 0.4 + u.outputTokens * 20) / 1_000_000;
}

export type TaggingResult = { tagged: number; batches: number; costUsd: number; errors: string[] };

/** Tag untagged videos the pipeline inserted (score >= 2 unless mode is "all"). */
export async function tagNewVideos(
  writer: LibraryWriter,
  opts: { mode: TaggingMode; model: string; batchSize: number; maxBatches: number; signal?: AbortSignal; log?: (m: string) => void },
): Promise<TaggingResult> {
  const result: TaggingResult = { tagged: 0, batches: 0, costUsd: 0, errors: [] };
  if (opts.mode === "off" || opts.maxBatches <= 0) return result;
  const provider = resolveProvider();
  if (!provider.ok) {
    // Not an error for the run: hosts without Claude simply keep new videos untagged.
    opts.log?.("tagging skipped: no Claude provider (set ANTHROPIC_API_KEY or sign in to the Claude Code CLI)");
    return result;
  }
  const db = libraryReader();
  const targets = db
    .prepare(
      `SELECT v.id, v.title, v.channel_id AS channelId, v.channel_name AS channelName, v.is_short AS isShort
       FROM live_videos lv JOIN videos v ON v.id = lv.row_id
       WHERE lv.tagged_at IS NULL AND lv.tag_attempts < 3 AND lv.origin = 'new' AND v.niches = '[]'
         AND (? = 'all' OR v.outlier_score >= ?)
       ORDER BY v.outlier_score DESC, lv.first_seen_at DESC LIMIT ?`,
    )
    .all(opts.mode, OUTLIER_THRESHOLD, opts.batchSize * opts.maxBatches) as Target[];
  if (!targets.length) return result;
  const t = loadTaxonomy();
  const schema = tagSchema(t);
  const system = systemPrompt(db, t);
  const nicheHints = new Map<string, string[]>();

  for (let i = 0; i < targets.length && !opts.signal?.aborted; i += opts.batchSize) {
    const batch = targets.slice(i, i + opts.batchSize);
    const lines = batch.map((v, n) => {
      const key = v.channelId ?? "";
      if (!nicheHints.has(key)) nicheHints.set(key, channelNiches(db, v.channelId));
      const usual = nicheHints.get(key) ?? [];
      return `${n + 1}. "${v.title}" (channel: ${v.channelName ?? "unknown"}${usual.length ? `; usual niches: ${usual.join(", ")}` : ""}${v.isShort ? "; a Short" : ""})`;
    });
    const req: AiRequest = {
      model: opts.model,
      system,
      messages: [{ role: "user", content: `Label these ${batch.length} videos:\n${lines.join("\n")}` }],
      effort: "low",
      maxTokens: 16_000,
      schema,
      signal: opts.signal,
    };
    result.batches++;
    try {
      const res = provider.provider === "anthropic" ? await runAnthropic(req) : await runClaudeCode(req);
      result.costUsd += usageCost(res.usage);
      const parsed = res.json as z.infer<typeof schema>;
      const now = nowIso();
      const labels = new Map(parsed.videos.map((v) => [v.n, v]));
      const tagged = writer.write((w) => {
        let count = 0;
        batch.forEach((video, n) => {
          const label = labels.get(n + 1);
          if (!label) {
            w.prepare("UPDATE live_videos SET tag_attempts = tag_attempts + 1 WHERE row_id = ?").run(video.id);
            return;
          }
          const triggers = [...new Set(label.clickTriggers)].slice(0, 4).sort();
          const updated = w
            .prepare("UPDATE videos SET niches = ?, click_triggers = ?, frame = ?, pov = ? WHERE id = ? AND niches = '[]'")
            .run(JSON.stringify([label.niche]), JSON.stringify(triggers), label.frame, label.pov, video.id);
          if (Number(updated.changes)) {
            w.prepare("DELETE FROM video_niches WHERE video_row_id = ?").run(video.id);
            w.prepare("INSERT OR IGNORE INTO video_niches (video_row_id, niche) VALUES (?, ?)").run(video.id, label.niche);
            w.prepare("DELETE FROM video_click_triggers WHERE video_row_id = ?").run(video.id);
            for (const trigger of triggers) {
              w.prepare("INSERT OR IGNORE INTO video_click_triggers (video_row_id, click_trigger) VALUES (?, ?)").run(video.id, trigger);
            }
            count++;
          }
          w.prepare("UPDATE live_videos SET tagged_at = ? WHERE row_id = ?").run(now, video.id);
        });
        return count;
      });
      result.tagged += tagged;
      opts.log?.(`tagged ${tagged}/${batch.length} videos (${res.provider}, ${res.model})`);
    } catch (err) {
      result.errors.push(`tagging batch failed: ${errorMessage(err)}`);
      writer.write((w) => {
        for (const video of batch) w.prepare("UPDATE live_videos SET tag_attempts = tag_attempts + 1 WHERE row_id = ?").run(video.id);
      });
      const code = (err as { code?: string }).code;
      if (code === "no_provider" || code === "auth" || code === "rate_limit" || code === "aborted") break;
    }
  }
  return result;
}
