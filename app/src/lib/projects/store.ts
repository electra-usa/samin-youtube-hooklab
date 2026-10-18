import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { activeChannel, appDb, newId, nowIso, tx } from "@/lib/db/app";
import { library, toOutlierVideo, type LibraryVideoRow } from "@/lib/db/library";
import type { CardVideo } from "@/components/video/VideoCard";
import { normalizeStatus, type ProjectStatus } from "./status";
import {
  PROJECT_ITEM_KINDS,
  type ProjectDetail,
  type ProjectItem,
  type ProjectItemKind,
  type ProjectStudioEntry,
  type ProjectSummary,
  type ProjectTitleEntry,
  type ProjectVideoEntry,
} from "./types";

// Projects: shared workspaces that collect chats, saved titles, videos, Studio
// workspaces and notes. Chats, pinned titles and Studio workspaces can also point at a
// project from their own rows (chats.project_id etc.), so the detail view merges both.

export class ProjectError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

let schemaReady = false;
function db(): DatabaseSync {
  const d = appDb();
  if (!schemaReady) {
    // The channel a project belongs to (original: Project.primaryChannelId).
    d.exec("CREATE TABLE IF NOT EXISTS project_channels (project_id TEXT PRIMARY KEY, user_channel_id TEXT)");
    schemaReady = true;
  }
  return d;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

function parseJson(text: unknown): unknown {
  if (typeof text !== "string" || !text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const asRecord = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});

// Everything that shows up on the detail page, counted the same way it is listed there.
const ITEM_COUNT_SQL = `(
  (SELECT count(*) FROM project_items i WHERE i.project_id = p.id AND i.kind != 'chat')
  + (SELECT count(*) FROM chats c WHERE c.project_id = p.id)
  + (SELECT count(*) FROM pinned_titles t WHERE t.project_id = p.id
       AND NOT EXISTS (SELECT 1 FROM project_items x WHERE x.project_id = p.id AND x.kind = 'title' AND x.ref_id = t.id))
  + (SELECT count(*) FROM studio_workspaces w WHERE w.project_id = p.id
       AND NOT EXISTS (SELECT 1 FROM project_items x WHERE x.project_id = p.id AND x.kind = 'studio' AND x.ref_id = w.id))
)`;

const SUMMARY_SQL = `
  SELECT p.id, p.name, p.description, p.status, p.created_at AS createdAt, p.updated_at AS updatedAt,
         uc.id AS primaryChannelId, uc.name AS primaryChannelName, uc.avatar AS primaryChannelAvatar,
         ${ITEM_COUNT_SQL} AS itemCount
  FROM projects p
  LEFT JOIN project_channels pc ON pc.project_id = p.id
  LEFT JOIN user_channels uc ON uc.id = pc.user_channel_id`;

function toSummary(r: Row): ProjectSummary {
  return {
    id: String(r.id),
    name: String(r.name),
    description: str(r.description),
    status: normalizeStatus(r.status) ?? "idea",
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt),
    itemCount: Number(r.itemCount ?? 0),
    primaryChannelId: str(r.primaryChannelId),
    primaryChannelName: str(r.primaryChannelName),
    primaryChannelAvatar: str(r.primaryChannelAvatar),
  };
}

function toItem(r: Row): ProjectItem {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    kind: r.kind as ProjectItemKind,
    refId: str(r.ref_id),
    payload: parseJson(r.payload_json),
    createdAt: String(r.created_at),
  };
}

export function listProjects(opts: { q?: string | null; status?: ProjectStatus | null } = {}): ProjectSummary[] {
  const where: string[] = [];
  const params: string[] = [];
  if (opts.status) {
    where.push("p.status = ?");
    params.push(opts.status);
  }
  const q = opts.q?.trim();
  if (q) {
    where.push("(p.name LIKE ? OR IFNULL(p.description, '') LIKE ? OR IFNULL(uc.name, '') LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const rows = db()
    .prepare(`${SUMMARY_SQL} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY p.updated_at DESC`)
    .all(...params) as Row[];
  return rows.map(toSummary);
}

export function getProjectSummary(id: string): ProjectSummary | null {
  const row = db().prepare(`${SUMMARY_SQL} WHERE p.id = ?`).get(id) as Row | undefined;
  return row ? toSummary(row) : null;
}

function requireProject(id: string) {
  const row = db().prepare("SELECT id FROM projects WHERE id = ?").get(id);
  if (!row) throw new ProjectError("Project not found", 404);
}

function touch(id: string) {
  db().prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(nowIso(), id);
}

function cleanName(v: unknown): string {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (!s) throw new ProjectError("Project name is required");
  if (s.length > 120) throw new ProjectError("Project names can be up to 120 characters");
  return s;
}

function cleanDescription(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== "string") throw new ProjectError("Description must be text");
  const s = v.trim();
  if (s.length > 4000) throw new ProjectError("Descriptions can be up to 4,000 characters");
  return s || null;
}

function cleanStatus(v: unknown): ProjectStatus {
  const s = normalizeStatus(v);
  if (!s) throw new ProjectError("status must be idea, in_progress or published");
  return s;
}

function cleanChannel(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v !== "string") throw new ProjectError("primaryChannelId must be a string");
  const row = db().prepare("SELECT id FROM user_channels WHERE id = ?").get(v);
  if (!row) throw new ProjectError("Unknown channel");
  return v;
}

export function createProject(input: {
  name?: unknown;
  description?: unknown;
  status?: unknown;
  primaryChannelId?: unknown;
}): ProjectSummary {
  const name = cleanName(input.name);
  const description = cleanDescription(input.description);
  const status = input.status === undefined ? "idea" : cleanStatus(input.status);
  // New projects belong to the active channel unless told otherwise (as in the original).
  const channelId = input.primaryChannelId === undefined ? (activeChannel()?.id ?? null) : cleanChannel(input.primaryChannelId);
  const id = newId();
  const now = nowIso();
  db();
  tx((d) => {
    d.prepare("INSERT INTO projects (id, name, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      id,
      name,
      description,
      status,
      now,
      now,
    );
    if (channelId) d.prepare("INSERT INTO project_channels (project_id, user_channel_id) VALUES (?, ?)").run(id, channelId);
  });
  return getProjectSummary(id)!;
}

export function updateProject(
  id: string,
  patch: { name?: unknown; description?: unknown; status?: unknown; primaryChannelId?: unknown },
): ProjectSummary {
  requireProject(id);
  const sets: string[] = [];
  const params: (string | null)[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    params.push(cleanName(patch.name));
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    params.push(cleanDescription(patch.description));
  }
  if (patch.status !== undefined) {
    sets.push("status = ?");
    params.push(cleanStatus(patch.status));
  }
  const channelId = patch.primaryChannelId === undefined ? undefined : cleanChannel(patch.primaryChannelId);
  tx((d) => {
    d.prepare(`UPDATE projects SET ${[...sets, "updated_at = ?"].join(", ")} WHERE id = ?`).run(...params, nowIso(), id);
    if (channelId !== undefined) {
      d.prepare("DELETE FROM project_channels WHERE project_id = ?").run(id);
      if (channelId) d.prepare("INSERT INTO project_channels (project_id, user_channel_id) VALUES (?, ?)").run(id, channelId);
    }
  });
  return getProjectSummary(id)!;
}

/** Deletes the project and its saved items; chats, pins and Studio workspaces are kept but unassigned. */
export function deleteProject(id: string): boolean {
  db();
  return tx((d) => {
    const res = d.prepare("DELETE FROM projects WHERE id = ?").run(id);
    if (!res.changes) return false;
    d.prepare("DELETE FROM project_items WHERE project_id = ?").run(id);
    d.prepare("DELETE FROM project_channels WHERE project_id = ?").run(id);
    d.prepare("UPDATE chats SET project_id = NULL WHERE project_id = ?").run(id);
    d.prepare("UPDATE pinned_titles SET project_id = NULL WHERE project_id = ?").run(id);
    d.prepare("UPDATE studio_workspaces SET project_id = NULL WHERE project_id = ?").run(id);
    return true;
  });
}

/** Called when a channel is removed: its projects stay, without a linked channel. */
export function unlinkChannelFromProjects(userChannelId: string) {
  db().prepare("DELETE FROM project_channels WHERE user_channel_id = ?").run(userChannelId);
}

export function listProjectItems(projectId: string): ProjectItem[] {
  requireProject(projectId);
  const rows = db().prepare("SELECT * FROM project_items WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as Row[];
  return rows.map(toItem);
}

function textOf(payload: unknown, ...keys: string[]): string | null {
  if (typeof payload === "string") return payload.trim() || null;
  const p = asRecord(payload);
  for (const k of keys) {
    const v = p[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Files something into a project. Adding the same chat, video, Studio workspace or title
 * twice returns the existing item instead of a duplicate (`created: false`).
 */
export function addProjectItem(
  projectId: string,
  input: { kind?: unknown; refId?: unknown; payload?: unknown },
): { item: ProjectItem; created: boolean } {
  const d = db();
  requireProject(projectId);
  const kind = PROJECT_ITEM_KINDS.find((k) => k === input.kind);
  if (!kind) throw new ProjectError(`kind must be one of: ${PROJECT_ITEM_KINDS.join(", ")}`);
  let refId = typeof input.refId === "string" && input.refId.trim() ? input.refId.trim() : null;
  let payload: unknown = input.payload ?? null;

  if (kind === "chat" || kind === "studio") {
    if (!refId) throw new ProjectError(`refId (the ${kind === "chat" ? "chat" : "workspace"} id) is required`);
    if (kind === "chat" && !d.prepare("SELECT id FROM chats WHERE id = ?").get(refId)) {
      throw new ProjectError("Chat not found", 404);
    }
  } else if (kind === "title") {
    const title = textOf(payload, "title", "text");
    if (!title) throw new ProjectError("payload.title is required");
    payload = { ...asRecord(payload), title };
  } else if (kind === "note") {
    const text = textOf(payload, "text", "body", "note");
    if (!text) throw new ProjectError("payload.text is required");
    payload = { text };
  } else {
    // video / bookmark: refId is the YouTube video id (or a bookmark id).
    refId = refId ?? str(asRecord(payload).videoId) ?? str(asRecord(asRecord(payload).video).videoId);
    if (!refId) throw new ProjectError("refId or payload.videoId is required");
  }

  const json = payload == null ? null : JSON.stringify(payload);
  if (json && json.length > 200_000) throw new ProjectError("Item is too large", 413);

  return tx((tdb) => {
    let existing: Row | undefined;
    if (kind === "title") {
      const title = textOf(payload, "title");
      existing = (tdb.prepare("SELECT * FROM project_items WHERE project_id = ? AND kind = 'title'").all(projectId) as Row[]).find(
        (r) => textOf(parseJson(r.payload_json), "title") === title,
      );
    } else if (kind === "video" || kind === "bookmark") {
      existing = tdb
        .prepare("SELECT * FROM project_items WHERE project_id = ? AND kind IN ('video', 'bookmark') AND ref_id = ?")
        .get(projectId, refId) as Row | undefined;
    } else if (kind !== "note") {
      existing = tdb.prepare("SELECT * FROM project_items WHERE project_id = ? AND kind = ? AND ref_id = ?").get(projectId, kind, refId) as
        | Row
        | undefined;
    }

    if (kind === "chat") {
      // A chat lives in one project at a time: moving it drops it from the old one.
      tdb.prepare("UPDATE chats SET project_id = ? WHERE id = ?").run(projectId, refId);
      tdb.prepare("DELETE FROM project_items WHERE kind = 'chat' AND ref_id = ? AND project_id != ?").run(refId, projectId);
    }
    if (existing) return { item: toItem(existing), created: false };

    const id = newId();
    const now = nowIso();
    tdb.prepare("INSERT INTO project_items (id, project_id, kind, ref_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      id,
      projectId,
      kind,
      refId,
      json,
      now,
    );
    tdb.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, projectId);
    return { item: { id, projectId, kind, refId, payload, createdAt: now }, created: true };
  });
}

/** Edits a note's text or a saved title. */
export function updateProjectItem(projectId: string, itemId: string, payloadPatch: unknown): ProjectItem {
  requireProject(projectId);
  const row = db().prepare("SELECT * FROM project_items WHERE id = ? AND project_id = ?").get(itemId, projectId) as Row | undefined;
  if (!row) throw new ProjectError("Item not found", 404);
  const current = asRecord(parseJson(row.payload_json));
  let next: Row;
  if (row.kind === "note") {
    const text = textOf(payloadPatch, "text");
    if (!text) throw new ProjectError("payload.text is required");
    next = { ...current, text, updatedAt: nowIso() };
  } else if (row.kind === "title") {
    const patch = asRecord(payloadPatch);
    const title = textOf(payloadPatch, "title") ?? textOf(current, "title");
    next = { ...current, ...patch, title };
  } else {
    throw new ProjectError("Only notes and titles can be edited");
  }
  db().prepare("UPDATE project_items SET payload_json = ? WHERE id = ?").run(JSON.stringify(next), itemId);
  touch(projectId);
  return toItem({ ...row, payload_json: JSON.stringify(next) });
}

/** Removes an entry from the project (see ProjectDetail entry ids). Returns false if nothing matched. */
export function removeProjectEntry(projectId: string, entryId: string): boolean {
  requireProject(projectId);
  const [prefix, ref] = entryId.includes(":") ? [entryId.slice(0, entryId.indexOf(":")), entryId.slice(entryId.indexOf(":") + 1)] : [null, entryId];
  const removed = tx((d) => {
    if (prefix === "chat") {
      const a = d.prepare("UPDATE chats SET project_id = NULL WHERE id = ? AND project_id = ?").run(ref, projectId).changes;
      const b = d.prepare("DELETE FROM project_items WHERE project_id = ? AND kind = 'chat' AND ref_id = ?").run(projectId, ref).changes;
      return Number(a) + Number(b) > 0;
    }
    if (prefix === "pin") {
      return d.prepare("UPDATE pinned_titles SET project_id = NULL WHERE id = ? AND project_id = ?").run(ref, projectId).changes > 0;
    }
    if (prefix === "studio") {
      const a = d.prepare("UPDATE studio_workspaces SET project_id = NULL WHERE id = ? AND project_id = ?").run(ref, projectId).changes;
      const b = d.prepare("DELETE FROM project_items WHERE project_id = ? AND kind = 'studio' AND ref_id = ?").run(projectId, ref).changes;
      return Number(a) + Number(b) > 0;
    }
    if (prefix) return false;
    const item = d.prepare("SELECT kind, ref_id FROM project_items WHERE id = ? AND project_id = ?").get(ref, projectId) as Row | undefined;
    if (!item) return false;
    d.prepare("DELETE FROM project_items WHERE id = ?").run(ref);
    if (item.kind === "chat") d.prepare("UPDATE chats SET project_id = NULL WHERE id = ? AND project_id = ?").run(String(item.ref_id), projectId);
    if (item.kind === "studio") {
      d.prepare("UPDATE studio_workspaces SET project_id = NULL WHERE id = ? AND project_id = ?").run(String(item.ref_id), projectId);
    }
    // A title saved from a pin may also be linked on the pin itself; unlink both.
    if (item.kind === "title" && item.ref_id) {
      d.prepare("UPDATE pinned_titles SET project_id = NULL WHERE id = ? AND project_id = ?").run(String(item.ref_id), projectId);
    }
    return true;
  });
  if (removed) touch(projectId);
  return removed;
}

/** Video card data from whatever the caller stored (an Outliers/Bookmarks video object). */
function videoFromObject(value: unknown, fallbackId: string | null): CardVideo | null {
  const outer = asRecord(value);
  const v = Object.keys(asRecord(outer.video)).length ? asRecord(outer.video) : outer;
  const videoId = str(v.videoId) ?? str(v.youtubeVideoId) ?? fallbackId;
  const title = str(v.title);
  if (!videoId || !title) return null;
  return {
    id: str(v.id) ?? undefined,
    videoId,
    title,
    thumbnail: str(v.thumbnail) ?? str(v.thumbnailUrl),
    videoUrl: str(v.videoUrl),
    channelId: str(v.channelId),
    channelName: str(v.channelName),
    subscriberCount: num(v.subscriberCount),
    views: num(v.views),
    outlierScore: num(v.outlierScore),
    publishAt: str(v.publishAt) ?? str(v.publishedAt),
    duration: str(v.duration),
    durationSeconds: num(v.durationSeconds),
    clickTriggers: Array.isArray(v.clickTriggers) ? v.clickTriggers.filter((t): t is string => typeof t === "string") : [],
  };
}

function lookupVideo(ref: string): CardVideo | null {
  const bookmark = db().prepare("SELECT video_json FROM bookmarks WHERE video_id = ? OR id = ?").get(ref, ref) as Row | undefined;
  const fromBookmark = bookmark ? videoFromObject(parseJson(bookmark.video_json), ref) : null;
  if (fromBookmark) return fromBookmark;
  try {
    const lib = library();
    const row = (lib.prepare("SELECT * FROM videos WHERE video_id = ? LIMIT 1").get(ref) ??
      lib.prepare("SELECT * FROM videos WHERE id = ? LIMIT 1").get(ref)) as LibraryVideoRow | undefined;
    if (row) return toOutlierVideo(row);
  } catch {
    // Library missing or being swapped; fall through to the synced channel videos.
  }
  const mine = db()
    .prepare("SELECT video_id, channel_id, title, thumbnail, views, duration_seconds, published_at, outlier_score FROM channel_videos WHERE video_id = ?")
    .get(ref) as Row | undefined;
  if (!mine) return null;
  return {
    videoId: String(mine.video_id),
    title: String(mine.title),
    thumbnail: str(mine.thumbnail),
    channelId: str(mine.channel_id),
    views: num(mine.views),
    durationSeconds: num(mine.duration_seconds),
    publishAt: str(mine.published_at),
    outlierScore: num(mine.outlier_score),
  };
}

export function getProjectDetail(id: string): ProjectDetail | null {
  const project = getProjectSummary(id);
  if (!project) return null;
  const d = db();
  const items = (d.prepare("SELECT * FROM project_items WHERE project_id = ? ORDER BY created_at DESC").all(id) as Row[]).map(toItem);

  const chats = (
    d
      .prepare(
        `SELECT c.id, c.title, c.updated_at AS updatedAt,
                (SELECT count(*) FROM chat_messages m WHERE m.chat_id = c.id) AS messageCount
         FROM chats c WHERE c.project_id = ? ORDER BY c.updated_at DESC`,
      )
      .all(id) as Row[]
  ).map((r) => ({
    entryId: `chat:${r.id}`,
    id: String(r.id),
    title: String(r.title || "Untitled chat"),
    updatedAt: String(r.updatedAt),
    messageCount: Number(r.messageCount ?? 0),
  }));

  const titleItems = items.filter((i) => i.kind === "title");
  const savedRefs = new Set(titleItems.map((i) => i.refId).filter(Boolean));
  const titles: ProjectTitleEntry[] = titleItems.map((i) => {
    const p = asRecord(i.payload);
    return {
      entryId: i.id,
      title: textOf(p, "title") ?? "",
      thumbnailText: str(p.thumbnailText),
      chatId: str(p.chatId),
      source: "saved",
      createdAt: i.createdAt,
    };
  });
  const pins = d.prepare("SELECT * FROM pinned_titles WHERE project_id = ? ORDER BY created_at DESC").all(id) as Row[];
  for (const pin of pins) {
    if (savedRefs.has(String(pin.id))) continue;
    const meta = asRecord(parseJson(pin.meta_json));
    titles.push({
      entryId: `pin:${pin.id}`,
      title: String(pin.title),
      thumbnailText: str(meta.thumbnailText),
      chatId: str(pin.chat_id),
      source: "pinned",
      createdAt: String(pin.created_at),
    });
  }
  titles.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const videos: ProjectVideoEntry[] = items
    .filter((i) => i.kind === "video" || i.kind === "bookmark")
    .map((i) => ({
      entryId: i.id,
      kind: i.kind as "video" | "bookmark",
      video: videoFromObject(i.payload, i.refId) ??
        (i.refId ? lookupVideo(i.refId) : null) ?? { videoId: i.refId ?? "", title: "Video no longer available" },
      createdAt: i.createdAt,
    }));

  const workspaceName = d.prepare("SELECT name, updated_at FROM studio_workspaces WHERE id = ?");
  const studioItems = items.filter((i) => i.kind === "studio");
  const studio: ProjectStudioEntry[] = studioItems.map((i) => {
    const ws = (i.refId ? workspaceName.get(i.refId) : undefined) as Row | undefined;
    return {
      entryId: i.id,
      workspaceId: i.refId ?? "",
      name: str(ws?.name) ?? textOf(i.payload, "name") ?? "Studio workspace",
      updatedAt: str(ws?.updated_at) ?? i.createdAt,
    };
  });
  const linkedIds = new Set(studioItems.map((i) => i.refId));
  for (const ws of d.prepare("SELECT id, name, updated_at FROM studio_workspaces WHERE project_id = ? ORDER BY updated_at DESC").all(id) as Row[]) {
    if (linkedIds.has(String(ws.id))) continue;
    studio.push({ entryId: `studio:${ws.id}`, workspaceId: String(ws.id), name: str(ws.name) ?? "Studio workspace", updatedAt: str(ws.updated_at) });
  }

  const notes = items
    .filter((i) => i.kind === "note")
    .map((i) => {
      const p = asRecord(i.payload);
      return { entryId: i.id, text: textOf(p, "text") ?? "", createdAt: i.createdAt, updatedAt: str(p.updatedAt) };
    });

  return { project, chats, titles, videos, studio, notes };
}
