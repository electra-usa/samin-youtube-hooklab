import "server-only";
import type { DatabaseSync } from "node:sqlite";

import { openLibraryReader } from "@/lib/core/library-db";
import { libraryDbPath } from "@/lib/core/paths";

// The video library (data/library.db). Shared with the CLI and refresh worker through
// src/lib/core; a fresh clone gets an empty library with the full schema.
export const LIBRARY_DB_PATH = libraryDbPath();

export function library(): DatabaseSync {
  return openLibraryReader();
}

/** Row shape of the `videos` table. */
export type LibraryVideoRow = {
  id: string;
  video_id: string;
  title: string;
  title_length: number | null;
  video_url: string;
  thumbnail_url: string;
  channel_id: string | null;
  channel_name: string | null;
  subscriber_count: number | null;
  views: number | null;
  outlier_score: number | null;
  tier: string | null;
  publish_at: string | null;
  duration: string | null;
  duration_seconds: number | null;
  is_short: number;
  frame: string | null;
  secondary_frame: string | null;
  pov: string | null;
  featured_in_newsletter: number;
  niches: string;
  click_triggers: string;
  video_types: string;
};

/** Video in the same JSON shape the original /api/outliers/videos returned. */
export type OutlierVideo = {
  id: string;
  videoId: string;
  title: string;
  titleLength: number | null;
  videoUrl: string;
  thumbnail: string;
  channelId: string | null;
  channelName: string | null;
  subscriberCount: number | null;
  views: number | null;
  outlierScore: number | null;
  publishAt: string | null;
  duration: string | null;
  durationSeconds: number | null;
  isShort: boolean;
  frame: string | null;
  secondaryFrame: string | null;
  pov: string | null;
  featuredInNewsletter: boolean;
  niches: string[];
  clickTriggers: string[];
  videoTypes: string[];
  isBookmarked: boolean;
  bookmarkTags: string[];
  projectIds: string[];
};

export function toOutlierVideo(row: LibraryVideoRow): OutlierVideo {
  return {
    id: row.id,
    videoId: row.video_id,
    title: row.title,
    titleLength: row.title_length,
    videoUrl: row.video_url,
    thumbnail: row.thumbnail_url,
    channelId: row.channel_id,
    channelName: row.channel_name,
    subscriberCount: row.subscriber_count,
    views: row.views,
    outlierScore: row.outlier_score,
    publishAt: row.publish_at,
    duration: row.duration,
    durationSeconds: row.duration_seconds,
    isShort: !!row.is_short,
    frame: row.frame,
    secondaryFrame: row.secondary_frame,
    pov: row.pov,
    featuredInNewsletter: !!row.featured_in_newsletter,
    niches: safeJsonArray(row.niches),
    clickTriggers: safeJsonArray(row.click_triggers),
    videoTypes: safeJsonArray(row.video_types),
    isBookmarked: false,
    bookmarkTags: [],
    projectIds: [],
  };
}

function safeJsonArray(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function libraryStats() {
  const db = library();
  const videos = (db.prepare("SELECT count(*) AS n FROM videos").get() as { n: number }).n;
  const channels = (db.prepare("SELECT count(*) AS n FROM channels").get() as { n: number }).n;
  const builtAt = (db.prepare("SELECT value FROM meta WHERE key = 'built_at'").get() as { value: string } | undefined)?.value;
  return { videos, channels, builtAt: builtAt ?? null };
}
