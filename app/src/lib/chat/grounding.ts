import "server-only";
import { CLICK_TRIGGERS } from "@/lib/taxonomy";
import { compactViews, outlierLabel } from "./format";
import type { ChannelVideo } from "./context";
import { addToVideoMap, knownChannelIds, lookupVideos, type ResearchStat, type ResearchVideo } from "./research";
import type { GeneratedTitleOutput } from "./schemas";
import type { ChatTitle, InspirationSource, VideoMap } from "./types";

// Turns model output into grounded app data: every videoId the model cites is checked
// against real library rows, and every number shown to the creator comes from those rows.

export class Evidence {
  private byId = new Map<string, ResearchVideo>();
  private byRef = new Map<string, ResearchVideo>();
  private stats = new Map<string, ResearchStat>();
  private own = new Map<string, ChannelVideo>();
  readonly videoMap: VideoMap = {};

  addVideos(videos: ResearchVideo[]) {
    for (const v of videos) {
      this.byId.set(v.videoId, v);
      if (v.ref) this.byRef.set(v.ref.toUpperCase(), v);
    }
  }

  addStats(stats: ResearchStat[]) {
    for (const s of stats) this.stats.set(s.ref.toUpperCase(), s);
  }

  addChannelVideos(videos: ChannelVideo[]) {
    for (const v of videos) this.own.set(v.videoId, v);
  }

  /** A cited id (videoId, or a research ref like "V3") resolved to a real library row. */
  resolve(id: string | null | undefined): ResearchVideo | null {
    const key = (id ?? "").trim().replace(/^videoId=/i, "");
    if (!key) return null;
    return this.byId.get(key) ?? this.byRef.get(key.toUpperCase()) ?? null;
  }

  /** Look up ids that weren't in the research set (e.g. linked from history) in the library. */
  hydrate(ids: string[]) {
    const missing = ids.filter((id) => !this.byId.has(id) && !this.own.has(id));
    if (!missing.length) return;
    for (const v of lookupVideos(missing).values()) this.byId.set(v.videoId, v);
  }

  cite(v: ResearchVideo): InspirationSource {
    addToVideoMap(this.videoMap, v);
    return { title: v.title, channelName: v.channelName };
  }

  /** {{video:ID}} → "Title" at 83.3K views (5.1x); {{stat:S2}} → the stat sentence. */
  expandPlaceholders(text: string): string {
    return text
      .replace(/\{\{\s*video\s*:\s*([^}\s]+)\s*\}\}/gi, (_, id: string) => {
        const v = this.resolve(id);
        if (!v) return "a comparable outlier in the library";
        addToVideoMap(this.videoMap, v);
        return `"${v.title}" at ${compactViews(v.views)} views (${outlierLabel(v.outlierScore)})`;
      })
      .replace(/\{\{\s*stat\s*:\s*([^}\s]+)\s*\}\}/gi, (_, ref: string, offset: number, whole: string) => {
        const s = this.stats.get(ref.toUpperCase());
        if (!s) return "";
        const clause = s.text.replace(/\.$/, "");
        const before = whole.slice(0, offset).trimEnd();
        const startsSentence = before === "" || /[.!?]$/.test(before);
        return startsSentence ? clause.charAt(0).toUpperCase() + clause.slice(1) : clause;
      })
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  /** Keep vref/cref links that point at real videos and channels (videos go into the videoMap); unlink the rest. */
  groundMarkdown(markdown: string): string {
    const ids = [...markdown.matchAll(/\]\(vref:([A-Za-z0-9_-]{6,})\)/g)].map((m) => m[1]);
    this.hydrate(ids);
    const channels = knownChannelIds([...markdown.matchAll(/\]\(cref:([A-Za-z0-9_-]+)\)/g)].map((m) => m[1]));
    markdown = markdown.replace(/\[([^\]]+)\]\(cref:([A-Za-z0-9_-]+)\)/g, (all, label: string, id: string) => (channels.has(id) ? all : label));
    return markdown.replace(/\[([^\]]+)\]\(vref:([A-Za-z0-9_-]+)\)/g, (all, label: string, id: string) => {
      const v = this.byId.get(id);
      if (v) {
        addToVideoMap(this.videoMap, v);
        return all;
      }
      const own = this.own.get(id);
      if (own) {
        this.videoMap[own.title.trim().toLowerCase()] = {
          title: own.title,
          views: compactViews(own.views),
          outlierScore: own.multiplier != null ? `${own.multiplier.toFixed(1)}x` : "",
          channelName: "Your channel",
          videoId: own.videoId,
          publishedAt: own.publishedAt,
        };
        return all;
      }
      return label;
    });
  }
}

const TRIGGERS_LOWER = new Map(CLICK_TRIGGERS.map((t) => [t.toLowerCase(), t]));

/** 1-2 valid click triggers joined with " + "; falls back to the skeleton video's own triggers. */
export function normalizeTriggers(raw: string[] | undefined, fallback: string[] = []): string | undefined {
  const picked: string[] = [];
  for (const r of raw ?? []) {
    for (const part of r.split(/\s*\+\s*|\s*,\s*/)) {
      const hit = TRIGGERS_LOWER.get(part.trim().toLowerCase());
      if (hit && !picked.includes(hit)) picked.push(hit);
    }
  }
  const list = picked.length ? picked : fallback.filter((t) => TRIGGERS_LOWER.has(t.toLowerCase()));
  return list.length ? list.slice(0, 2).join(" + ") : undefined;
}

const cleanTitle = (t: string) => t.replace(/\s+/g, " ").replace(/^["“]|["”]$/g, "").trim();

/** Build a grounded ChatTitle from a generated title. */
export function buildTitle(
  raw: GeneratedTitleOutput,
  id: string,
  angle: { name?: string; emoji?: string } | null,
  evidence: Evidence,
): ChatTitle {
  const primary = evidence.resolve(raw.skeletonVideoId);
  const secondary = evidence.resolve(raw.secondaryVideoId);
  const sources = [primary, secondary].filter((v, i, all): v is ResearchVideo => !!v && all.findIndex((x) => x?.videoId === v.videoId) === i);
  const notes = raw.slotNotes?.trim();
  let derivation: string | undefined;
  if (sources.length) {
    derivation = `skeleton:${sources.map((s) => s.videoId).join(" + ")}${notes ? `, ${notes}` : ""}`;
  } else if (notes) {
    derivation = `adapted: ${notes}`;
  }
  return {
    id,
    title: cleanTitle(raw.title),
    ...(angle?.name ? { angle: angle.name } : {}),
    ...(angle?.emoji ? { angleEmoji: angle.emoji } : {}),
    clickTrigger: normalizeTriggers(raw.clickTriggers, primary?.clickTriggers ?? []),
    derivation,
    inspirationSources: sources.map((s) => evidence.cite(s)),
  };
}
