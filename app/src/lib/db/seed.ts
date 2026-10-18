import "server-only";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

// First-run import of the signed-in account export (data/account, written by
// scripts/export-account.mjs) so the rebuild opens with the same channel, profile,
// preferences and My Channel history the original showed.
const ACCOUNT_DIR = process.env.ACCOUNT_EXPORT_DIR ?? path.resolve(process.cwd(), "..", "data", "account");

function readBody(name: string): unknown {
  const file = path.join(ACCOUNT_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return null;
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  return doc && typeof doc === "object" && !Array.isArray(doc) && "body" in doc ? doc.body : doc;
}

type ExportedChannel = { id: string; channelId: string; name: string; avatar: string; isActive: boolean; subscriberCount: number };
type ExportedVideo = {
  videoId: string;
  title: string;
  thumbnail: string;
  views: number;
  publishAt: string;
  durationSeconds: number;
  isShort: boolean;
  isLivestream: boolean;
  comparison?: { avgViews: number; multiplier: string; rank: number; totalCompared: number };
};

export function seedFromAccountExport(db: DatabaseSync) {
  const now = new Date().toISOString();
  const session = readBody("auth-session") as { user?: { id?: string; name?: string | null; email?: string; image?: string | null } } | null;
  const channelsBody = readBody("user-channels") as { channels?: ExportedChannel[] } | null;
  const channels = channelsBody?.channels ?? [];
  const primary = channels.find((c) => c.isActive) ?? channels[0];

  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO users (id, name, email, image, created_at) VALUES (?, ?, ?, ?, ?)").run(
      session?.user?.id ?? randomUUID(),
      session?.user?.name ?? primary?.name ?? "Creator",
      session?.user?.email ?? null,
      session?.user?.image ?? primary?.avatar ?? null,
      now,
    );

    for (const c of channels) {
      db.prepare(
        `INSERT OR IGNORE INTO user_channels (id, channel_id, name, avatar, subscriber_count, is_active, created_at, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(c.id, c.channelId, c.name, c.avatar, c.subscriberCount ?? null, c.isActive ? 1 : 0, now, now);

      const profile = readBody(`channel-${c.id}-profile`);
      if (profile) {
        db.prepare("INSERT OR REPLACE INTO channel_profiles VALUES (?, ?, ?)").run(c.id, JSON.stringify(profile), now);
      }
      const style = readBody(`channel-${c.id}-style-guide`) as { styleGuide?: string | null } | null;
      db.prepare("INSERT OR REPLACE INTO style_guides VALUES (?, ?, ?)").run(c.id, style?.styleGuide ?? null, now);
      const prefs = readBody(`channel-${c.id}-chat-preferences`) as { chatPreferences?: Record<string, unknown> } | null;
      if (prefs?.chatPreferences) {
        db.prepare("INSERT OR REPLACE INTO chat_preferences VALUES (?, ?, ?)").run(c.id, JSON.stringify(prefs.chatPreferences), now);
      }
    }

    if (primary) {
      for (const type of ["longform", "shorts"] as const) {
        const videos = (readBody(`my-channel-videos-${type}`) as ExportedVideo[] | null) ?? [];
        const insert = db.prepare(
          `INSERT OR REPLACE INTO channel_videos
           (video_id, user_channel_id, channel_id, title, thumbnail, views, duration_seconds, published_at, type,
            outlier_score, comparison_json, raw, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        const snapshot = db.prepare("INSERT OR IGNORE INTO video_view_snapshots VALUES (?, ?, ?)");
        for (const v of videos) {
          const kind = v.isLivestream ? "live" : v.isShort ? "shorts" : type;
          const multiplier = v.comparison?.multiplier != null ? Number(v.comparison.multiplier) : null;
          insert.run(
            v.videoId, primary.id, primary.channelId, v.title, v.thumbnail, v.views ?? 0, v.durationSeconds ?? 0,
            v.publishAt, kind, multiplier, v.comparison ? JSON.stringify(v.comparison) : null, JSON.stringify(v), now,
          );
          snapshot.run(v.videoId, now, v.views ?? 0);
        }
      }
    }

    // Following lists and their per-list chat instructions.
    const lists = (readBody("following-lists") as { lists?: { id: string; name: string; type: string; createdAt: string; ChannelListItem?: { channelId?: string; channel?: { channelId?: string; name?: string; avatar?: string; subscriberCount?: number } }[] }[] } | null)?.lists ?? [];
    for (const l of lists) {
      db.prepare("INSERT OR IGNORE INTO following_lists (id, name, type, created_at) VALUES (?, ?, ?, ?)").run(l.id, l.name, l.type ?? null, l.createdAt ?? now);
      for (const item of l.ChannelListItem ?? []) {
        const cid = item.channel?.channelId ?? item.channelId;
        if (!cid) continue;
        db.prepare("INSERT OR IGNORE INTO followed_channels (channel_id, name, avatar, subscriber_count, added_at) VALUES (?, ?, ?, ?, ?)").run(
          cid, item.channel?.name ?? null, item.channel?.avatar ?? null, item.channel?.subscriberCount ?? null, now,
        );
        db.prepare("INSERT OR IGNORE INTO following_list_channels VALUES (?, ?)").run(l.id, cid);
      }
    }

    const outlierPrefs = readBody("user-outliers-preferences") as {
      outliersDefaultFilters?: unknown;
      hiddenChannels?: { channelId: string; channelName: string }[];
    } | null;
    if (outlierPrefs?.outliersDefaultFilters) {
      db.prepare("INSERT OR REPLACE INTO settings VALUES ('outliers.defaultFilters', ?)").run(JSON.stringify(outlierPrefs.outliersDefaultFilters));
    }
    for (const h of outlierPrefs?.hiddenChannels ?? []) {
      db.prepare("INSERT OR IGNORE INTO hidden_channels VALUES (?, ?, ?)").run(h.channelId, h.channelName, now);
    }

    const languages = readBody("user-content-languages") as { selectedContentLanguages?: string[] } | null;
    db.prepare("INSERT OR REPLACE INTO settings VALUES ('contentLanguages', ?)").run(JSON.stringify(languages?.selectedContentLanguages ?? ["en"]));
    db.prepare("INSERT OR REPLACE INTO settings VALUES ('emailPreferences', ?)").run(JSON.stringify({ weeklyIdeas: false }));
    db.prepare("INSERT OR REPLACE INTO settings VALUES ('theme', ?)").run(JSON.stringify("light"));

    const trial = readBody("user-trial-status") as { creditLimit?: number; creditPeriodEndsAt?: string } | null;
    db.prepare("INSERT OR REPLACE INTO settings VALUES ('credits', ?)").run(
      JSON.stringify({ plan: "pro", monthlyLimit: trial?.creditLimit ?? 3000, periodEndsAt: trial?.creditPeriodEndsAt ?? null }),
    );

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
