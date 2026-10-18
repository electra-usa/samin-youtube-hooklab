import "server-only";
import { newId, nowIso } from "@/lib/db/app";
import { channelDb } from "./schema";
import type { ChannelVideoRow, VideoKind } from "./videos";
import {
  MILESTONES,
  compactViews,
  exactViews,
  milestoneTitle,
  type EligibilitySegment,
  type Trophy,
  type TrophyEligibility,
  type TrophyTarget,
} from "./trophy-format";

// Trophy rules. Static evidence: milestone artwork keys 100/1K/10K/100K/1M/10M and
// the VIEW_MILESTONE type (client bundles); runtime evidence: the "How trophies work"
// modal and the four "Upcoming Trophies" on Samin's account. Inferred (matches that
// capture): a kind's "often get" level is the median views of its 10 latest videos;
// milestones at or below that level aren't eligible; a trophy is earned when a video
// passes an eligible milestone after tracking started (its first view snapshot, or
// 0 for videos published after the channel was added).

const KIND_ORDER: VideoKind[] = ["shorts", "longform", "live"];
const SEGMENT: Record<VideoKind, Pick<EligibilitySegment, "videoKind" | "videoKindLabel" | "subjectLabel">> = {
  shorts: { videoKind: "SHORT", videoKindLabel: "Shorts", subjectLabel: "your Shorts" },
  longform: { videoKind: "LONG_FORM", videoKindLabel: "Long-form videos", subjectLabel: "your long-form videos" },
  live: { videoKind: "LIVESTREAM", videoKindLabel: "Live streams", subjectLabel: "your live streams" },
};

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function channelRows(userChannelId: string): ChannelVideoRow[] {
  return channelDb().prepare("SELECT * FROM channel_videos WHERE user_channel_id = ?").all(userChannelId) as ChannelVideoRow[];
}

type KindRule = EligibilitySegment & { kind: VideoKind };

function eligibilityRules(rows: ChannelVideoRow[]): KindRule[] {
  const rules: KindRule[] = [];
  for (const kind of KIND_ORDER) {
    const ofKind = rows.filter((r) => r.type === kind);
    if (!ofKind.length) continue;
    const recent = [...ofKind].sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? "")).slice(0, 10);
    const typical = median(recent.map((r) => r.views ?? 0));
    const floor = [...MILESTONES].reverse().find((m) => m <= typical) ?? null;
    const eligible = floor == null ? MILESTONES[0] : (MILESTONES.find((m) => m > floor) ?? floor);
    rules.push({
      kind,
      ...SEGMENT[kind],
      eligibleMilestone: eligible,
      eligibleMilestoneLabel: compactViews(eligible),
      includeAndAbove: floor != null,
      milestoneLabel: floor != null ? compactViews(floor) : null,
    });
  }
  return rules;
}

const qualifies = (rule: KindRule, m: number) => (rule.includeAndAbove ? m >= rule.eligibleMilestone : m === rule.eligibleMilestone);

export function getTrophyEligibility(userChannelId: string): TrophyEligibility {
  return {
    segments: eligibilityRules(channelRows(userChannelId)).map((r) => ({
      videoKind: r.videoKind,
      videoKindLabel: r.videoKindLabel,
      subjectLabel: r.subjectLabel,
      eligibleMilestone: r.eligibleMilestone,
      eligibleMilestoneLabel: r.eligibleMilestoneLabel,
      includeAndAbove: r.includeAndAbove,
      milestoneLabel: r.milestoneLabel,
    })),
  };
}

/** The four videos closest (by progress) to their next eligible milestone. */
export function getNextTargets(userChannelId: string, limit = 4): TrophyTarget[] {
  const rows = channelRows(userChannelId);
  const rules = new Map(eligibilityRules(rows).map((r) => [r.kind, r]));
  const targets: TrophyTarget[] = [];
  for (const r of rows) {
    const rule = rules.get(r.type as VideoKind);
    if (!rule) continue;
    const views = r.views ?? 0;
    const next = MILESTONES.find((m) => qualifies(rule, m) && m > views);
    if (!next) continue;
    targets.push({
      id: `${r.video_id}-${next}`,
      type: "VIEW_MILESTONE",
      milestone: next,
      title: milestoneTitle(next),
      videoId: r.video_id,
      videoTitle: r.title,
      videoThumbnail: r.thumbnail,
      publishAt: r.published_at,
      currentViews: views,
      currentLabel: `${exactViews(views)} views`,
      targetLabel: `${exactViews(next)} views`,
      progress: Math.min(100, (views / next) * 100),
    });
  }
  return targets.sort((a, b) => b.progress - a.progress || b.currentViews - a.currentViews).slice(0, limit);
}

type TrophyRow = {
  id: string;
  video_id: string;
  milestone: number;
  achieved_at: string;
  seen: number;
  type: string | null;
  title: string | null;
  views_at_award: number | null;
  video_title: string | null;
  thumbnail: string | null;
  views: number | null;
  published_at: string | null;
};

function toTrophy(r: TrophyRow, channelName: string | null): Trophy {
  return {
    id: r.id,
    type: (r.type as Trophy["type"]) ?? "VIEW_MILESTONE",
    milestone: r.milestone,
    title: r.title ?? milestoneTitle(r.milestone),
    videoId: r.video_id,
    videoTitle: r.video_title ?? "",
    videoThumbnail: r.thumbnail,
    channelName,
    viewsAtAward: r.views_at_award,
    earnedAt: r.achieved_at,
    acknowledgedAt: r.seen ? r.achieved_at : null,
    currentViews: r.views,
    videoPublishAt: r.published_at,
  };
}

function queryTrophies(userChannelId: string, unseenOnly: boolean): Trophy[] {
  const db = channelDb();
  const channel = db.prepare("SELECT name FROM user_channels WHERE id = ?").get(userChannelId) as { name: string | null } | undefined;
  const rows = db
    .prepare(
      `SELECT t.id, t.video_id, t.milestone, t.achieved_at, t.seen, a.type, a.title, a.views_at_award,
              v.title AS video_title, v.thumbnail, v.views, v.published_at
       FROM trophies t
       JOIN channel_videos v ON v.video_id = t.video_id
       LEFT JOIN trophy_awards a ON a.trophy_id = t.id
       WHERE v.user_channel_id = ? ${unseenOnly ? "AND t.seen = 0" : ""}
       ORDER BY t.achieved_at DESC, t.milestone DESC`,
    )
    .all(userChannelId) as TrophyRow[];
  return rows.map((r) => toTrophy(r, channel?.name ?? null));
}

export const listTrophies = (userChannelId: string) => queryTrophies(userChannelId, false);
export const listUnseenTrophies = (userChannelId: string) => queryTrophies(userChannelId, true);

export function markTrophiesSeen(ids: string[]): number {
  if (!ids.length) return 0;
  const res = channelDb()
    .prepare(`UPDATE trophies SET seen = 1 WHERE id IN (${ids.map(() => "?").join(",")})`)
    .run(...ids);
  return Number(res.changes);
}

/** Award milestone trophies the latest views earned. Call inside the sync transaction. */
export function awardTrophies(userChannelId: string, trackingStartedAt: string): Trophy[] {
  const db = channelDb();
  const rows = channelRows(userChannelId);
  const rules = new Map(eligibilityRules(rows).map((r) => [r.kind, r]));
  const first = new Map(
    (
      db
        .prepare(
          `SELECT s.video_id, s.views FROM video_view_snapshots s
           JOIN (SELECT s2.video_id, MIN(s2.captured_at) AS t FROM video_view_snapshots s2
                 JOIN channel_videos v ON v.video_id = s2.video_id WHERE v.user_channel_id = ? GROUP BY s2.video_id) m
             ON m.video_id = s.video_id AND m.t = s.captured_at`,
        )
        .all(userChannelId) as { video_id: string; views: number }[]
    ).map((r) => [r.video_id, r.views]),
  );
  const existing = new Set(
    (
      db
        .prepare("SELECT t.video_id, t.milestone FROM trophies t JOIN channel_videos v ON v.video_id = t.video_id WHERE v.user_channel_id = ?")
        .all(userChannelId) as { video_id: string; milestone: number }[]
    ).map((t) => `${t.video_id}:${t.milestone}`),
  );

  const insertTrophy = db.prepare("INSERT OR IGNORE INTO trophies (id, video_id, milestone, achieved_at, seen) VALUES (?, ?, ?, ?, 0)");
  const insertAward = db.prepare(
    `INSERT OR REPLACE INTO trophy_awards (trophy_id, user_channel_id, type, title, views_at_award, baseline_views, outlier_score_at_award)
     VALUES (?, ?, 'VIEW_MILESTONE', ?, ?, ?, ?)`,
  );
  const now = nowIso();
  const awarded: string[] = [];
  for (const r of rows) {
    const rule = rules.get(r.type as VideoKind);
    if (!rule) continue;
    const views = r.views ?? 0;
    const publishedAfterStart = !!r.published_at && r.published_at > trackingStartedAt;
    const baseline = publishedAfterStart ? 0 : (first.get(r.video_id) ?? views);
    for (const m of MILESTONES) {
      if (!qualifies(rule, m) || m <= baseline || m > views || existing.has(`${r.video_id}:${m}`)) continue;
      const id = newId();
      insertTrophy.run(id, r.video_id, m, now);
      insertAward.run(id, userChannelId, milestoneTitle(m), views, baseline, r.outlier_score);
      awarded.push(id);
    }
  }
  if (!awarded.length) return [];
  const set = new Set(awarded);
  return listTrophies(userChannelId).filter((t) => set.has(t.id));
}
