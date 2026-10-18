import { z } from "zod";

// Studio workspace model, mirroring the original's snapshot (version 1): lists of
// titles, thumbnail texts and thumbnails, which items are selected, one shared
// text style, and the active tab. Every selected combination is a "combo".

export const STUDIO_VIEWS = ["workspace", "devices", "preview-youtube", "tiny", "blur", "share"] as const;
export type StudioView = (typeof STUDIO_VIEWS)[number];

export const STUDIO_TABS: { id: StudioView; label: string }[] = [
  { id: "workspace", label: "Workspace" },
  { id: "devices", label: "Devices" },
  { id: "preview-youtube", label: "YouTube Preview" },
  { id: "tiny", label: "Tiny Test" },
  { id: "blur", label: "Blur Test" },
  { id: "share", label: "Share" },
];

export const STUDIO_FONT_OPTIONS = [
  { value: "roboto", label: "Roboto" },
  { value: "impact", label: "Impact" },
  { value: "montserrat", label: "Montserrat" },
  { value: "bebas-neue", label: "Bebas Neue" },
  { value: "oswald", label: "Oswald" },
  { value: "arial-black", label: "Arial Black" },
  { value: "poppins", label: "Poppins" },
  { value: "inter", label: "Inter" },
] as const;

export type TextAlign = "left" | "center" | "right";
export type TextPosition = "top" | "center" | "bottom" | "left" | "right";

export type StyleSettings = {
  font: string;
  fontSize: number;
  fontColor: string;
  textAlign: TextAlign;
  textPosition: TextPosition;
  textPositionX?: number;
  textPositionY?: number;
};

export type StudioState = {
  titles: string[];
  thumbnailTexts: string[];
  thumbnails: string[];
  selectedTitleIndices: number[];
  selectedThumbnailTextIndices: number[];
  selectedThumbnailIndices: number[];
  styleSettings: StyleSettings;
  activeView: StudioView;
};

export type StudioSnapshot = StudioState & { version: 1; thumbnailStorageKeys: (string | null)[] };

export type Combo = { id: string; title: string; thumbnailText: string; imageUrl: string };

export const DEFAULT_STYLE: StyleSettings = {
  font: "roboto",
  fontSize: 30,
  fontColor: "#FFFFFF",
  textAlign: "center",
  textPosition: "center",
};

export const DEFAULT_STATE: StudioState = {
  titles: [""],
  thumbnailTexts: [""],
  thumbnails: [],
  selectedTitleIndices: [0],
  selectedThumbnailTextIndices: [0],
  selectedThumbnailIndices: [],
  styleSettings: DEFAULT_STYLE,
  activeView: "workspace",
};

const styleSchema = z
  .object({
    font: z.string().trim().min(1).max(100),
    fontSize: z.number().finite().min(8).max(200),
    fontColor: z.string().trim().min(1).max(32),
    textAlign: z.enum(["left", "center", "right"]),
    textPosition: z.enum(["top", "center", "bottom", "left", "right"]),
    textPositionX: z.number().finite().min(0).max(100),
    textPositionY: z.number().finite().min(0).max(100),
  })
  .partial();

const indices = z.array(z.number().int().nonnegative()).max(500);

export const studioStateSchema = z.object({
  version: z.number().int().optional(),
  titles: z.array(z.string().max(500)).max(200).optional(),
  thumbnailTexts: z.array(z.string().max(500)).max(200).optional(),
  thumbnails: z.array(z.string().max(2048)).max(100).optional(),
  selectedTitleIndices: indices.optional(),
  selectedThumbnailTextIndices: indices.optional(),
  selectedThumbnailIndices: indices.optional(),
  styleSettings: styleSchema.optional(),
  activeView: z.string().optional(),
  thumbnailStorageKeys: z.array(z.string().trim().min(1).nullable()).optional(),
});

const inRange = (list: number[] | undefined, length: number) =>
  [...new Set((list ?? []).filter((i) => i >= 0 && i < length))].sort((a, b) => a - b);

/** Coerce anything (a stored snapshot, a session draft) into a valid state. */
export function normalizeState(input: unknown): StudioState {
  const parsed = studioStateSchema.safeParse(input ?? {});
  const o = parsed.success ? parsed.data : {};
  const titles = o.titles ? o.titles.map((t) => t ?? "") : DEFAULT_STATE.titles;
  const thumbnailTexts = o.thumbnailTexts ? o.thumbnailTexts.map((t) => t ?? "") : DEFAULT_STATE.thumbnailTexts;
  const thumbnails = (o.thumbnails ?? []).map((t) => t.trim()).filter(Boolean);
  const view = o.activeView === "pinned" ? "workspace" : o.activeView === "scroll" ? "preview-youtube" : o.activeView;
  return {
    titles,
    thumbnailTexts,
    thumbnails,
    selectedTitleIndices: inRange(o.selectedTitleIndices ?? [0], titles.length),
    selectedThumbnailTextIndices: inRange(o.selectedThumbnailTextIndices ?? [0], thumbnailTexts.length),
    selectedThumbnailIndices: inRange(o.selectedThumbnailIndices, thumbnails.length),
    styleSettings: { ...DEFAULT_STYLE, ...(o.styleSettings ?? {}) } as StyleSettings,
    activeView: (STUDIO_VIEWS as readonly string[]).includes(view ?? "") ? (view as StudioView) : "workspace",
  };
}

/** Drop in-flight local (blob:) thumbnails, keeping the selection aligned. */
export function withoutLocalThumbnails(state: StudioState): StudioState {
  if (!state.thumbnails.some((t) => t.startsWith("blob:") || t.startsWith("data:"))) return state;
  const keep: number[] = [];
  state.thumbnails.forEach((t, i) => !t.startsWith("blob:") && !t.startsWith("data:") && keep.push(i));
  return {
    ...state,
    thumbnails: keep.map((i) => state.thumbnails[i]),
    selectedThumbnailIndices: state.selectedThumbnailIndices.filter((i) => keep.includes(i)).map((i) => keep.indexOf(i)),
  };
}

export function toSnapshot(state: StudioState, storageKeys: Record<string, string> = {}): StudioSnapshot {
  return { version: 1, ...state, thumbnailStorageKeys: state.thumbnails.map((t) => storageKeys[t] ?? null) };
}

const filled = (s: string) => s.trim() !== "";

export const hasContent = (s: StudioState) => s.titles.some(filled) || s.thumbnailTexts.some(filled) || s.thumbnails.length > 0;

/** Landing screen until there's a title or a thumbnail. */
export const isBlank = (s: StudioState) => !s.titles.some(filled) && s.thumbnails.length === 0;

/**
 * Every selected title x thumbnail text x thumbnail. With nothing selected yet the
 * workspace still shows one placeholder card (id "combo-empty").
 */
export function buildCombos(s: StudioState): Combo[] {
  const titles = s.titles.length ? s.titles : [""];
  const pickedTitles = inRange(s.selectedTitleIndices, titles.length).map((i) => titles[i]).filter(filled);
  const pickedTexts = inRange(s.selectedThumbnailTextIndices, s.thumbnailTexts.length).map((i) => s.thumbnailTexts[i]).filter(filled);
  let images = [""];
  if (s.thumbnails.length) {
    const picked = inRange(s.selectedThumbnailIndices, s.thumbnails.length).map((i) => s.thumbnails[i]).filter(filled);
    if (picked.length) images = picked;
  }
  if (!pickedTitles.length && !pickedTexts.length && !images.some(filled)) {
    return [{ id: "combo-empty", title: "", thumbnailText: "", imageUrl: "" }];
  }
  const ts = pickedTitles.length ? pickedTitles : [""];
  const xs = pickedTexts.length ? pickedTexts : [""];
  const combos: Combo[] = [];
  for (const title of ts) for (const thumbnailText of xs) for (const imageUrl of images) combos.push({ id: `combo-${combos.length}`, title, thumbnailText, imageUrl });
  return combos;
}

export const realCombos = (s: StudioState) => buildCombos(s).filter((c) => c.id !== "combo-empty");

/** Text anchor in percent of the thumbnail (dragged position wins over the preset). */
export function textAnchor(style: Partial<StyleSettings> | undefined): { x: number; y: number } {
  if (style?.textPositionX !== undefined && style?.textPositionY !== undefined) return { x: style.textPositionX, y: style.textPositionY };
  switch (style?.textPosition) {
    case "top":
      return { x: 50, y: 15 };
    case "bottom":
      return { x: 50, y: 85 };
    case "left":
      return { x: 15, y: 50 };
    case "right":
      return { x: 85, y: 50 };
    default:
      return { x: 50, y: 50 };
  }
}

export function defaultWorkspaceName(s: StudioState, now = new Date()): string {
  const title = s.titles.find(filled)?.trim();
  if (title) return title.slice(0, 80);
  return `Studio workspace ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(now)}`;
}
