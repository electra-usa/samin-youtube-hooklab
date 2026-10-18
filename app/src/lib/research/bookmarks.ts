import "server-only";
import { appDb, newId, nowIso, tx } from "@/lib/db/app";
import type { OutlierVideo } from "@/lib/db/library";
import { SHORTS_MAX_SECONDS } from "./filters";
import { findAnyVideo } from "./videos";

// Bookmarks keep a snapshot of the video (so they survive library rebuilds) plus
// user tags. Tags are global to the user, as in the original.

export type BookmarkVideo = Partial<OutlierVideo> & { videoId: string; title: string };

export type Bookmark = {
  id: string;
  videoId: string;
  isShort: boolean;
  createdAt: string;
  tags: string[];
  projectIds: string[];
  video: BookmarkVideo;
};

export type Tag = { id: string; name: string; count: number };

export class BookmarkError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

type Row = { id: string; video_id: string; video_json: string; is_short: number; created_at: string };

function parseVideo(row: Row): BookmarkVideo {
  try {
    return { ...(JSON.parse(row.video_json) as BookmarkVideo), videoId: row.video_id };
  } catch {
    return { videoId: row.video_id, title: row.video_id };
  }
}

export function listBookmarks(): Bookmark[] {
  const db = appDb();
  const rows = db.prepare("SELECT * FROM bookmarks ORDER BY created_at DESC").all() as Row[];
  const tagRows = db
    .prepare("SELECT bt.bookmark_id, t.name FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id ORDER BY t.name COLLATE NOCASE")
    .all() as { bookmark_id: string; name: string }[];
  const tags = new Map<string, string[]>();
  for (const r of tagRows) tags.set(r.bookmark_id, [...(tags.get(r.bookmark_id) ?? []), r.name]);
  const projectRows = db
    .prepare("SELECT DISTINCT ref_id, project_id FROM project_items WHERE kind IN ('video', 'bookmark')")
    .all() as { ref_id: string; project_id: string }[];
  const projects = new Map<string, string[]>();
  for (const r of projectRows) projects.set(r.ref_id, [...(projects.get(r.ref_id) ?? []), r.project_id]);
  return rows.map((r) => ({
    id: r.id,
    videoId: r.video_id,
    isShort: !!r.is_short,
    createdAt: r.created_at,
    tags: tags.get(r.id) ?? [],
    projectIds: [...new Set([...(projects.get(r.video_id) ?? []), ...(projects.get(r.id) ?? [])])],
    video: parseVideo(r),
  }));
}

export function getBookmark(videoId: string): Bookmark | null {
  return listBookmarks().find((b) => b.videoId === videoId) ?? null;
}

/** Bookmark a video. The library copy (scores, triggers) wins over what the client sent. */
export function addBookmark(input: Partial<OutlierVideo> & { videoId?: string }): Bookmark {
  const videoId = typeof input.videoId === "string" ? input.videoId.trim() : "";
  if (!/^[\w-]{6,20}$/.test(videoId)) throw new BookmarkError("A valid videoId is required");
  const known = findAnyVideo(videoId);
  const video: BookmarkVideo = { ...input, ...(known ?? {}), videoId, title: known?.title ?? input.title ?? "" };
  if (!video.title) throw new BookmarkError("Video not found", 404);
  delete video.isBookmarked;
  delete video.bookmarkTags;
  delete video.projectIds;
  const isShort = video.isShort ?? (video.durationSeconds != null && video.durationSeconds <= SHORTS_MAX_SECONDS);
  const db = appDb();
  const existing = db.prepare("SELECT id FROM bookmarks WHERE video_id = ?").get(videoId) as { id: string } | undefined;
  if (existing) {
    db.prepare("UPDATE bookmarks SET video_json = ?, is_short = ? WHERE id = ?").run(JSON.stringify(video), isShort ? 1 : 0, existing.id);
  } else {
    db.prepare("INSERT INTO bookmarks (id, video_id, video_json, is_short, created_at) VALUES (?, ?, ?, ?, ?)").run(
      newId(), videoId, JSON.stringify(video), isShort ? 1 : 0, nowIso(),
    );
  }
  return getBookmark(videoId)!;
}

export function removeBookmark(videoId: string): boolean {
  const row = appDb().prepare("SELECT id FROM bookmarks WHERE video_id = ?").get(videoId) as { id: string } | undefined;
  if (!row) return false;
  tx((db) => {
    db.prepare("DELETE FROM bookmark_tags WHERE bookmark_id = ?").run(row.id);
    db.prepare("DELETE FROM bookmarks WHERE id = ?").run(row.id);
  });
  return true;
}

export function listTags(): Tag[] {
  return appDb()
    .prepare(
      `SELECT t.id, t.name, count(bt.bookmark_id) AS count FROM tags t
       LEFT JOIN bookmark_tags bt ON bt.tag_id = t.id
       GROUP BY t.id ORDER BY t.name COLLATE NOCASE`,
    )
    .all() as Tag[];
}

function cleanTagName(name: unknown): string {
  const value = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (!value) throw new BookmarkError("Tag name is required");
  if (value.length > 40) throw new BookmarkError("Tag names can be at most 40 characters");
  return value;
}

/** Find a tag by id or (case-insensitive) name. */
export function findTag(idOrName: string): { id: string; name: string } | null {
  return (
    (appDb().prepare("SELECT id, name FROM tags WHERE id = ? OR name = ? COLLATE NOCASE LIMIT 1").get(idOrName, idOrName) as
      | { id: string; name: string }
      | undefined) ?? null
  );
}

function ensureTag(name: string): { id: string; name: string } {
  const existing = findTag(name);
  if (existing) return existing;
  const id = newId();
  appDb().prepare("INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)").run(id, name, nowIso());
  return { id, name };
}

export function createTag(name: unknown): Tag {
  const clean = cleanTagName(name);
  if (findTag(clean)) throw new BookmarkError(`Tag "${clean}" already exists`, 409);
  const tag = ensureTag(clean);
  return { ...tag, count: 0 };
}

export function renameTag(idOrName: string, name: unknown): Tag {
  const tag = findTag(idOrName);
  if (!tag) throw new BookmarkError("Tag not found", 404);
  const clean = cleanTagName(name);
  const clash = findTag(clean);
  if (clash && clash.id !== tag.id) throw new BookmarkError(`Tag "${clean}" already exists`, 409);
  appDb().prepare("UPDATE tags SET name = ? WHERE id = ?").run(clean, tag.id);
  return listTags().find((t) => t.id === tag.id)!;
}

export function deleteTag(idOrName: string) {
  const tag = findTag(idOrName);
  if (!tag) throw new BookmarkError("Tag not found", 404);
  tx((db) => {
    db.prepare("DELETE FROM bookmark_tags WHERE tag_id = ?").run(tag.id);
    db.prepare("DELETE FROM tags WHERE id = ?").run(tag.id);
  });
}

function bookmarkIdFor(videoId: string): string {
  const row = appDb().prepare("SELECT id FROM bookmarks WHERE video_id = ?").get(videoId) as { id: string } | undefined;
  if (!row) throw new BookmarkError("Bookmark not found", 404);
  return row.id;
}

/** Add tags (created on the fly) to a bookmark; returns the bookmark's tags. */
export function addTagsToBookmark(videoId: string, names: unknown[]): string[] {
  const bookmarkId = bookmarkIdFor(videoId);
  const clean = [...new Set(names.map(cleanTagName))];
  tx((db) => {
    for (const name of clean) {
      const tag = ensureTag(name);
      db.prepare("INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)").run(bookmarkId, tag.id);
    }
  });
  return getBookmark(videoId)?.tags ?? [];
}

export function removeTagFromBookmark(videoId: string, idOrName: string): string[] {
  const bookmarkId = bookmarkIdFor(videoId);
  const tag = findTag(idOrName);
  if (tag) appDb().prepare("DELETE FROM bookmark_tags WHERE bookmark_id = ? AND tag_id = ?").run(bookmarkId, tag.id);
  return getBookmark(videoId)?.tags ?? [];
}

export function setBookmarkTags(videoId: string, names: unknown[]): string[] {
  const bookmarkId = bookmarkIdFor(videoId);
  const clean = [...new Set(names.map(cleanTagName))];
  tx((db) => {
    db.prepare("DELETE FROM bookmark_tags WHERE bookmark_id = ?").run(bookmarkId);
    for (const name of clean) {
      const tag = ensureTag(name);
      db.prepare("INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)").run(bookmarkId, tag.id);
    }
  });
  return getBookmark(videoId)?.tags ?? [];
}
