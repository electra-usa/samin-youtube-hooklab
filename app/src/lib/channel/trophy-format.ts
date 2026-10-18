// Trophy types and labels shared by the server (lib/channel/trophies.ts) and the
// Trophy Case UI. Milestones and theme colors come from the original's client bundle.

export const MILESTONES = [100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000];

export const TROPHY_THEME: Record<number, string> = {
  100: "#F5D547",
  1_000: "#EAA800",
  10_000: "#6AC23F",
  100_000: "#4C8ECD",
  1_000_000: "#A25AF1",
  10_000_000: "#0D0D0D",
};

export type TrophyType = "VIEW_MILESTONE";

export type Trophy = {
  id: string;
  type: TrophyType;
  milestone: number;
  title: string;
  videoId: string;
  videoTitle: string;
  videoThumbnail: string | null;
  channelName: string | null;
  viewsAtAward: number | null;
  earnedAt: string;
  acknowledgedAt: string | null;
  currentViews: number | null;
  videoPublishAt: string | null;
};

export type TrophyTarget = {
  id: string;
  type: TrophyType;
  milestone: number;
  title: string;
  videoId: string;
  videoTitle: string;
  videoThumbnail: string | null;
  publishAt: string | null;
  currentViews: number;
  currentLabel: string;
  targetLabel: string;
  progress: number;
};

export type EligibilitySegment = {
  videoKind: "SHORT" | "LONG_FORM" | "LIVESTREAM";
  videoKindLabel: string;
  subjectLabel: string;
  eligibleMilestone: number;
  eligibleMilestoneLabel: string;
  includeAndAbove: boolean;
  milestoneLabel: string | null;
};

export type TrophyEligibility = { segments: EligibilitySegment[] };

export function compactViews(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function exactViews(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

export const milestoneTitle = (m: number) => `${compactViews(m)} Views`;

export const trophyThemeColor = (m: number) => TROPHY_THEME[m] ?? TROPHY_THEME[100];

/** Bullet sentences for the "How trophies work" modal. */
export function eligibilitySentences(e: TrophyEligibility): { key: string; label: string | null; sentence: string }[] {
  const segs = e.segments;
  const onlyLongForm = segs.length === 1 && segs[0].videoKind === "LONG_FORM";
  return segs.map((s) => {
    const subject = onlyLongForm ? "your videos" : s.subjectLabel;
    const plain = `${subject} are eligible for ${s.eligibleMilestoneLabel}-view trophies${s.includeAndAbove ? " and above" : ""}`;
    return {
      key: `${s.videoKind}-${s.eligibleMilestoneLabel}`,
      label: segs.length > 1 ? s.videoKindLabel : null,
      sentence: s.milestoneLabel
        ? `Since ${subject} often get ${s.milestoneLabel} views, they're eligible for ${s.eligibleMilestoneLabel}-view trophies and above.`
        : `${plain[0].toUpperCase()}${plain.slice(1)}.`,
    };
  });
}

/** Milestone the empty-state hero shows: the biggest one in play. */
export function heroMilestone(e: TrophyEligibility, targets: TrophyTarget[]): number {
  return [...e.segments.map((s) => s.eligibleMilestone), ...targets.map((t) => t.milestone)].reduce((a, b) => (b > a ? b : a), 100);
}
