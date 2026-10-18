import type { AngleCard, CardExpansionBatch, ChatTitle, MessageCards, VideoMap, VideoRef } from "./types";

// Display helpers shared by the server (videoMap strings) and the chat UI (copy text).

/** "83.3K", "1.2M", "950" — the videoMap format of the original (always one decimal). */
export function compactViews(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "0";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export function outlierLabel(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return "";
  return `${score >= 100 ? Math.round(score) : score.toFixed(1)}x`;
}

export function videoMapById(map: VideoMap | null | undefined): Record<string, VideoRef> {
  const out: Record<string, VideoRef> = {};
  for (const v of Object.values(map ?? {})) out[v.videoId] = v;
  return out;
}

export function findVideoRef(map: VideoMap | null | undefined, title: string): VideoRef | undefined {
  if (!map) return undefined;
  const key = title.trim().toLowerCase();
  if (map[key]) return map[key];
  const stripped = key.replace(/\s*(\([^()]*\)|\[[^[\]]*\])\s*$/g, "").trim();
  return Object.values(map).find((v) => v.title.trim().toLowerCase() === stripped);
}

const numbered = (titles: ChatTitle[]) => titles.map((t, i) => `${i + 1}. ${t.title}`).join("\n");

function stripMarkdown(s: string): string {
  return s
    .replace(/```(?:\w+)?\n?([\s\S]*?)```/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}>\s?/gm, "")
    .trim();
}

/** Plain-text version of an assistant reply, used by "Copy message" (same layout as the original). */
export function messageCopyText(content: string, cards: MessageCards | null): string {
  if (!cards) return stripMarkdown(content);
  const parts: string[] = [];
  const intro = cards.summary ?? cards.intro;
  if (intro) parts.push(intro);
  if (cards.bodyMarkdown && !cards.angleCards?.length) parts.push(cards.bodyMarkdown);
  if (cards.angleCards?.length) {
    parts.push(
      cards.angleCards
        .map((card: AngleCard) => {
          const more = (cards.expansions?.[card.id] ?? []).flatMap((b: CardExpansionBatch) => b.titles);
          return [
            `Angle: ${card.name}${card.isRecommended ? " (Recommended)" : ""}`,
            card.description ? `Description: ${card.description}` : null,
            card.recommendationReason ? `Recommendation reason: ${card.recommendationReason}` : null,
            card.titles.length ? `Titles:\n${numbered(card.titles)}` : null,
            more.length ? `More titles:\n${numbered(more)}` : null,
          ]
            .filter(Boolean)
            .join("\n\n");
        })
        .join("\n\n---\n\n"),
    );
    if (cards.bodyMarkdown) parts.push(cards.bodyMarkdown);
  }
  if (cards.titles?.length && !cards.angleCards?.length) parts.push(`Titles:\n${numbered(cards.titles)}`);
  if (cards.thumbnailTexts?.length) {
    parts.push(`Thumbnail text:\n${cards.thumbnailTexts.map((t, i) => `${i + 1}. ${t.text}`).join("\n")}`);
  }
  if (!parts.length) return stripMarkdown(content);
  if (content && !cards.angleCards?.length && !cards.thumbnailTexts?.length && content !== intro) parts.push(content);
  return stripMarkdown(parts.join("\n\n"));
}
