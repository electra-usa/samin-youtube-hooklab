import { z } from "zod";

// Structured-output schemas. Property order matters: the model writes fields in this order,
// so titles stream before each angle's card is complete.

export const INTENTS = [
  "titles",
  "more_titles",
  "thumbnail",
  "compare_titles",
  "video_ideas",
  "channels_to_study",
  "whats_working",
  "outline",
  "intro",
  "description",
  "latest_video_analysis",
  "audience_psychology",
  "channel_strategy",
  "general",
] as const;

export const RouteSchema = z.object({
  intent: z.enum(INTENTS),
  topic: z.string().describe("One sentence describing the video idea or subject; empty string if none."),
  searchQueries: z.array(z.string()).describe("3-6 short keyword queries (2-4 words each) for a YouTube title search."),
  focusAngle: z.string().describe("Angle name when the creator wants more titles in one earlier angle; else empty."),
  chatTitle: z.string().describe("3-7 word Title Case chat title when requested; else empty."),
});
export type RouteOutput = z.infer<typeof RouteSchema>;

const GeneratedTitle = z.object({
  title: z.string(),
  clickTriggers: z.array(z.string()).describe("1-2 names from the click trigger list."),
  skeletonVideoId: z.string().describe("videoId of the research video whose structure this title adapts."),
  secondaryVideoId: z.string().describe("Second research videoId when two skeletons were blended; else empty."),
  slotNotes: z.string().describe("A few words on how the skeleton's slots were filled."),
});
export type GeneratedTitleOutput = z.infer<typeof GeneratedTitle>;

export const TitlesSchema = z.object({
  summary: z.string(),
  angles: z.array(
    z.object({
      name: z.string(),
      emoji: z.string(),
      description: z.string(),
      titles: z.array(GeneratedTitle),
      isRecommended: z.boolean(),
      recommendationReason: z.string().describe("Only for the recommended angle; else empty. Cite with {{video:ID}} / {{stat:S#}}."),
    }),
  ),
  bodyMarkdown: z.string(),
  suggestedFollowups: z.array(z.string()),
});
export type TitlesOutput = z.infer<typeof TitlesSchema>;

export const MoreTitlesSchema = z.object({ titles: z.array(GeneratedTitle) });
export type MoreTitlesOutput = z.infer<typeof MoreTitlesSchema>;

export const ThumbnailSchema = z.object({
  summary: z.string(),
  thumbnailTexts: z.array(
    z.object({
      text: z.string(),
      sourceVideoId: z.string().describe("Research videoId that inspired it; else empty."),
    }),
  ),
  bodyMarkdown: z.string(),
  suggestedFollowups: z.array(z.string()),
});
export type ThumbnailOutput = z.infer<typeof ThumbnailSchema>;

export const MarkdownSchema = z.object({
  markdown: z.string(),
  suggestedFollowups: z.array(z.string()),
});
export type MarkdownOutput = z.infer<typeof MarkdownSchema>;

export const ProfileSchema = z.object({
  overview: z.string(),
  primaryNiches: z.array(z.string()),
});
export type ProfileOutput = z.infer<typeof ProfileSchema>;
