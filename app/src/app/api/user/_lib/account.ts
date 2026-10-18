import "server-only";
import { appDb, currentUser, getSetting, listUserChannels, setSetting } from "@/lib/db/app";
import { seedFromAccountExport } from "@/lib/db/seed";
import { CONTENT_LANGUAGES } from "@/components/settings/shared";

// Account-level settings behind the /api/user routes (profile, languages, email, reset).

export class AccountError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function updateProfile(input: { name?: unknown; email?: unknown }) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim() : "";
  if (!name) throw new AccountError("Name is required");
  if (name.length > 100) throw new AccountError("Name can be up to 100 characters");
  if (!email) throw new AccountError("Email is required");
  if (!EMAIL_RE.test(email)) throw new AccountError("Enter a valid email address");
  const user = currentUser();
  if (!user) throw new AccountError("No local user found", 404);
  appDb().prepare("UPDATE users SET name = ?, email = ? WHERE id = ?").run(name, email, user.id);
  return { name, email };
}

const LANGUAGE_LABELS = new Map(CONTENT_LANGUAGES.map((l) => [l.code, l.label]));

/** Same shape as the original GET /api/user/content-languages. */
export function getContentLanguages() {
  const stored = getSetting<unknown>("contentLanguages", ["en"]);
  const codes = (Array.isArray(stored) ? stored : []).filter((c): c is string => typeof c === "string" && LANGUAGE_LABELS.has(c));
  return {
    selectedContentLanguages: codes,
    labels: Object.fromEntries(codes.map((c) => [c, LANGUAGE_LABELS.get(c)!])),
  };
}

export function setContentLanguages(input: unknown) {
  if (!Array.isArray(input)) throw new AccountError("selectedContentLanguages must be an array of language codes");
  const unknown = input.filter((c) => typeof c !== "string" || !LANGUAGE_LABELS.has(c));
  if (unknown.length) throw new AccountError(`Unsupported language: ${unknown.join(", ")}`);
  // Keep the picker's order; an empty list means "allow all languages".
  const codes = CONTENT_LANGUAGES.map((l) => l.code).filter((c) => input.includes(c));
  setSetting("contentLanguages", codes);
  return getContentLanguages();
}

export type EmailPreferences = { weeklyIdeasEmailOptIn: boolean; featuredChannelIds: string[] };

export function getEmailPreferences(): EmailPreferences {
  const raw = getSetting<{ weeklyIdeas?: boolean; weeklyIdeasEmailOptIn?: boolean; featuredChannelIds?: unknown }>("emailPreferences", {});
  return {
    weeklyIdeasEmailOptIn: Boolean(raw.weeklyIdeasEmailOptIn ?? raw.weeklyIdeas ?? false),
    featuredChannelIds: Array.isArray(raw.featuredChannelIds) ? raw.featuredChannelIds.filter((v): v is string => typeof v === "string") : [],
  };
}

/** Stored locally only: HookLab never sends the weekly email. */
export function updateEmailPreferences(patch: { weeklyIdeasEmailOptIn?: unknown; featuredChannelIds?: unknown }) {
  const current = getEmailPreferences();
  const next = { ...current };
  if (patch.weeklyIdeasEmailOptIn !== undefined) {
    if (typeof patch.weeklyIdeasEmailOptIn !== "boolean") throw new AccountError("weeklyIdeasEmailOptIn must be true or false");
    next.weeklyIdeasEmailOptIn = patch.weeklyIdeasEmailOptIn;
  }
  if (patch.featuredChannelIds !== undefined) {
    if (!Array.isArray(patch.featuredChannelIds)) throw new AccountError("featuredChannelIds must be an array");
    const known = new Set(listUserChannels().map((c) => c.channelId));
    const ids = [...new Set(patch.featuredChannelIds.filter((v): v is string => typeof v === "string" && known.has(v)))];
    if (ids.length > 4) throw new AccountError("You can select up to 4 channels");
    next.featuredChannelIds = ids;
  }
  // `weeklyIdeas` is the key the first-run seed writes; keep it in sync.
  setSetting("emailPreferences", { weeklyIdeas: next.weeklyIdeasEmailOptIn, ...next });
  return next;
}

/**
 * Danger Zone: wipes every table in data/app.db and re-imports the account export, so
 * HookLab looks like a first run. The exported library (data/creatorhooks.db) is not touched.
 */
export function resetLocalData() {
  const db = appDb();
  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]
  ).map((t) => t.name);
  db.exec("BEGIN");
  try {
    for (const name of tables) db.exec(`DELETE FROM "${name.replace(/"/g, '""')}"`);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  seedFromAccountExport(db);
  return { clearedTables: tables.length };
}
