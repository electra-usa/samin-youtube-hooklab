import "server-only";
import fs from "node:fs";
import path from "node:path";
import { appDb, newId, nowIso } from "@/lib/db/app";
import { normalizeState, toSnapshot, withoutLocalThumbnails, type StudioSnapshot } from "@/components/studio/model";

// Studio persistence: workspaces in studio_workspaces (state_json holds the
// snapshot) and uploaded thumbnails on disk under data/studio-uploads, indexed in
// studio_assets (id = file key).

export const UPLOADS_DIR = process.env.STUDIO_UPLOADS_DIR ?? path.resolve(process.cwd(), "..", "data", "studio-uploads");

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MIME_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp" };
const EXT_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
const KEY_RE = /^[0-9a-f-]{36}\.(png|jpg|webp)$/;

export type WorkspaceRecord = {
  id: string;
  name: string;
  projectId: string | null;
  projectName: string | null;
  state: StudioSnapshot;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceSummary = Omit<WorkspaceRecord, "state"> & { thumbnail: string | null; titles: string[] };

type Row = { id: string; name: string; project_id: string | null; state_json: string; created_at: string; updated_at: string };

function projectName(projectId: string | null): string | null {
  if (!projectId) return null;
  const row = appDb().prepare("SELECT name FROM projects WHERE id = ?").get(projectId) as { name: string } | undefined;
  return row?.name ?? null;
}

function parseSnapshot(json: string): StudioSnapshot {
  let raw: unknown = {};
  try {
    raw = JSON.parse(json);
  } catch {
    // keep defaults
  }
  const keys = (raw as { thumbnailStorageKeys?: (string | null)[] })?.thumbnailStorageKeys ?? [];
  const state = normalizeState(raw);
  return { version: 1, ...state, thumbnailStorageKeys: state.thumbnails.map((_, i) => keys[i] ?? null) };
}

function toRecord(r: Row): WorkspaceRecord {
  return {
    id: r.id,
    name: r.name,
    projectId: r.project_id,
    projectName: projectName(r.project_id),
    state: parseSnapshot(r.state_json),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listWorkspaces(): WorkspaceSummary[] {
  const rows = appDb().prepare("SELECT * FROM studio_workspaces ORDER BY updated_at DESC").all() as Row[];
  return rows.map((r) => {
    const { state, ...rest } = toRecord(r);
    return { ...rest, thumbnail: state.thumbnails[0] ?? null, titles: state.titles.filter((t) => t.trim()).slice(0, 5) };
  });
}

export function getWorkspace(id: string): WorkspaceRecord | null {
  const row = appDb().prepare("SELECT * FROM studio_workspaces WHERE id = ?").get(id) as Row | undefined;
  return row ? toRecord(row) : null;
}

/** Validated snapshot JSON; storage keys are derived from our own upload URLs. */
function snapshotJson(state: unknown): string {
  const normalized = withoutLocalThumbnails(normalizeState(state));
  const keys: Record<string, string> = {};
  for (const t of normalized.thumbnails) {
    const k = keyFromUrl(t);
    if (k) keys[t] = k;
  }
  return JSON.stringify(toSnapshot(normalized, keys));
}

function keyFromUrl(url: string): string | null {
  const m = /^\/api\/studio\/thumbnails\/([^/?#]+)$/.exec(url);
  return m && KEY_RE.test(m[1]) ? m[1] : null;
}

function linkAssets(workspaceId: string, stateJson: string) {
  const snapshot = JSON.parse(stateJson) as StudioSnapshot;
  const keys = snapshot.thumbnailStorageKeys.filter((k): k is string => !!k);
  if (!keys.length) return;
  appDb()
    .prepare(`UPDATE studio_assets SET workspace_id = ? WHERE workspace_id IS NULL AND id IN (${keys.map(() => "?").join(",")})`)
    .run(workspaceId, ...keys);
}

export function createWorkspace(input: { name: string; state: unknown; projectId?: string | null }): WorkspaceRecord {
  const id = newId();
  const now = nowIso();
  const json = snapshotJson(input.state);
  appDb()
    .prepare("INSERT INTO studio_workspaces (id, name, project_id, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, input.name.trim().slice(0, 200) || "Studio workspace", input.projectId ?? null, json, now, now);
  linkAssets(id, json);
  return getWorkspace(id)!;
}

export function updateWorkspace(id: string, patch: { name?: string; state?: unknown; projectId?: string | null }): WorkspaceRecord | null {
  const current = getWorkspace(id);
  if (!current) return null;
  const sets: string[] = [];
  const params: (string | null)[] = [];
  if (patch.name !== undefined && patch.name.trim()) {
    sets.push("name = ?");
    params.push(patch.name.trim().slice(0, 200));
  }
  let json: string | null = null;
  if (patch.state !== undefined) {
    json = snapshotJson(patch.state);
    sets.push("state_json = ?");
    params.push(json);
  }
  if (patch.projectId !== undefined) {
    sets.push("project_id = ?");
    params.push(patch.projectId);
  }
  if (!sets.length) return current;
  sets.push("updated_at = ?");
  params.push(nowIso());
  appDb()
    .prepare(`UPDATE studio_workspaces SET ${sets.join(", ")} WHERE id = ?`)
    .run(...params, id);
  if (json) linkAssets(id, json);
  return getWorkspace(id);
}

/** Removes the workspace row only; uploaded images stay on disk. */
export function deleteWorkspace(id: string): boolean {
  return Number(appDb().prepare("DELETE FROM studio_workspaces WHERE id = ?").run(id).changes) > 0;
}

export function isAcceptedImage(mime: string | null | undefined): mime is keyof typeof MIME_EXT {
  return !!mime && mime in MIME_EXT;
}

/** Saves an image and returns its key and same-origin URL. */
export function saveUpload(data: Buffer, mime: string, kind = "thumbnail"): { key: string; publicUrl: string } {
  const ext = MIME_EXT[mime];
  if (!ext) throw new Error("Upload a PNG, JPG, or WEBP image");
  if (data.byteLength > MAX_UPLOAD_BYTES) throw new Error("Image must be less than 5 MB");
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const key = `${newId()}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, key), data);
  appDb()
    .prepare("INSERT INTO studio_assets (id, workspace_id, kind, file_path, mime, created_at) VALUES (?, NULL, ?, ?, ?, ?)")
    .run(key, kind, key, mime === "image/jpg" ? "image/jpeg" : mime, nowIso());
  return { key, publicUrl: `/api/studio/thumbnails/${key}` };
}

export function readUpload(key: string): { data: Buffer; mime: string } | null {
  if (!KEY_RE.test(key)) return null;
  const file = path.join(UPLOADS_DIR, key);
  if (!fs.existsSync(file)) return null;
  return { data: fs.readFileSync(file), mime: EXT_MIME[key.split(".").pop()!] ?? "application/octet-stream" };
}

/** Sniff the real image type from the first bytes (don't trust the browser's label). */
export function sniffImageType(data: Buffer): string | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}
