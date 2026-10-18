// Settings constants and shapes shared by the Settings UI and the /api/user routes.

export type SettingsTab = "profile" | "channels" | "billing" | "teams";
export const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "channels", label: "Channels" },
  { id: "billing", label: "Billing" },
  { id: "teams", label: "Teams" },
];
export const isSettingsTab = (v: unknown): v is SettingsTab => SETTINGS_TABS.some((t) => t.id === v);

/** Languages offered by the original "Allowed content languages" picker. */
export const CONTENT_LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "pa", label: "Punjabi" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "hi", label: "Hindi" },
];

export const BANNED_PUNCTUATION_OPTIONS = [
  "Period (.)",
  "Comma (,)",
  "Exclamation mark (!)",
  "Colon (:)",
  "Dash (-)",
  "Em dash (—)",
  "Parentheses ()",
  "Square brackets ([ ])",
  "Ellipsis (…)",
  "Vertical bar (|)",
  "Asterisk (*)",
];

/** Per-channel title/thumbnail/script rules (original StyleGuide model). Stored as JSON in style_guides.content. */
export type StyleGuide = {
  maxTitleLength: number;
  minThumbnailWords: number;
  maxThumbnailWords: number;
  /** JSON array of BANNED_PUNCTUATION_OPTIONS labels, or "" (kept as a string like the original). */
  bannedPunctuation: string;
  bannedWordsPhrases: string[];
  scriptWritingRules: string;
};

export const DEFAULT_STYLE_GUIDE: StyleGuide = {
  maxTitleLength: 100,
  minThumbnailWords: 3,
  maxThumbnailWords: 5,
  bannedPunctuation: "",
  bannedWordsPhrases: [],
  scriptWritingRules: "",
};

export function parseBannedPunctuation(value: unknown): string[] {
  const list = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim()
      ? (() => {
          try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];
  return list.filter((v): v is string => typeof v === "string" && BANNED_PUNCTUATION_OPTIONS.includes(v));
}

/** Body of GET /api/user/channel-profile (and channel_profiles.profile_json), as in the original. */
export type ChannelProfileBody = {
  profile: {
    overview: string;
    aboutMyChannel?: string;
    channelId?: string;
    generatedAt?: string;
    basedOnVideoCount?: number;
  } | null;
  generatedAt: string | null;
  primaryNiches: string[];
  topics: string[];
};

/** chat_preferences.prefs_json (original ChatPreferences model). */
export type ChatPreferences = {
  id?: string;
  userChannelId: string;
  /** null = all lists. */
  listIdsToUse: string[] | null;
  /** null = all bookmark tags. */
  bookmarkTagsToUse: string[] | null;
  /** Per following-list instruction text, keyed by list id. */
  listInstructions: Record<string, string>;
  additionalInstructions: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type DataSources = {
  lists: { id: string; name: string; type: string | null; channelCount: number }[];
  bookmarkTags: string[];
};

export const MAX_TOPICS = 12;

/** Topics are lowercase, unique and capped at 12 (as in the original). */
export function normalizeTopics(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") continue;
    const t = v.trim().replace(/,+$/, "").toLowerCase();
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_TOPICS) break;
  }
  return out;
}
