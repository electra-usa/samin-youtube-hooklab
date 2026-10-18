// Shapes shared by the chat API, the SSE stream and the chat UI (client-safe: no server imports).
// Field names follow the original Creator Hooks payloads (evidence/chat-stream-response.txt).

export const SSE_VERSION = "1.0";

export type InspirationSource = { title: string; channelName: string };

export type ChatTitle = {
  id: string;
  title: string;
  angle?: string;
  angleEmoji?: string;
  /** 1–2 of the 48 click triggers joined with " + ", e.g. "Experience + Time Frame". */
  clickTrigger?: string;
  /** "skeleton:<videoId>, <how the slots were filled>" */
  derivation?: string;
  inspirationSources: InspirationSource[];
};

export type AngleCard = {
  id: string;
  name: string;
  emoji: string;
  description: string;
  titles: ChatTitle[];
  isRecommended: boolean;
  recommendationReason?: string;
};

export type ThumbnailText = { id: string; text: string; inspirationSources?: InspirationSource[] };

/** Library video referenced by a reply. Keys of VideoMap are lowercased titles (as in the original). */
export type VideoRef = {
  title: string;
  views: string;
  outlierScore: string;
  channelName: string;
  videoId: string;
  publishedAt: string | null;
};
export type VideoMap = Record<string, VideoRef>;

/** A "More titles →" batch appended to an angle card. */
export type CardExpansionBatch = {
  batchIndex: number;
  generationId: string;
  titles: ChatTitle[];
  createdAt: string;
  cancelled?: boolean;
};

/** Structured content of an assistant message (chat_messages.cards_json). */
export type MessageCards = {
  summary?: string;
  intro?: string;
  bodyMarkdown?: string;
  angleCards?: AngleCard[];
  titles?: ChatTitle[];
  thumbnailTexts?: ThumbnailText[];
  suggestedFollowups?: string[];
  /** HookLab: "More titles" batches keyed by angle card id. */
  expansions?: Record<string, CardExpansionBatch[]>;
};

export type Intent =
  | "titles"
  | "more_titles"
  | "thumbnail"
  | "compare_titles"
  | "video_ideas"
  | "channels_to_study"
  | "whats_working"
  | "outline"
  | "intro"
  | "description"
  | "latest_video_analysis"
  | "audience_psychology"
  | "channel_strategy"
  | "general";

export type MessageMeta = {
  intent?: Intent;
  topic?: string;
  searchQueries?: string[];
  videoMap?: VideoMap;
  provider?: string;
  model?: string;
  credits?: number;
  generationId?: string;
  canned?: boolean;
  cancelled?: boolean;
  error?: string;
  errorCode?: string;
};

export type PromptPillMeta = {
  promptId: string;
  label: string;
  prompt: string;
  isCanned: boolean;
  wasPinned?: boolean;
  isFixed?: boolean;
  slotIndex?: number;
  messageDepth?: number;
};

export type MessageFeedback = { rating: "positive" | "negative"; reason?: string; comment?: string };

export type AttachmentRef = { id: string; type: string; label: string | null };

export type ChatMessageDTO = {
  id: string;
  role: "user" | "assistant";
  content: string;
  cards: MessageCards | null;
  metadata: MessageMeta | null;
  attachments: AttachmentRef[] | null;
  promptPill: PromptPillMeta | null;
  feedback: MessageFeedback | null;
  createdAt: string;
};

export type AttachmentType = "transcript" | "document";
export type AttachmentSource = "youtube_url" | "pasted" | "upload";

/** Context attached to a chat (or a draft on the new-chat page before the chat exists). */
export type ChatAttachment = {
  id: string;
  type: AttachmentType;
  sourceType: AttachmentSource;
  status: "ready";
  label: string | null;
  sourceUrl: string | null;
  sourceVideoId: string | null;
  transcriptText: string | null;
  charCount: number;
  createdAt: string;
};

export type ChatMeta = {
  id: string;
  title: string;
  projectId: string | null;
  projectName: string | null;
  channelId: string | null;
  channelName: string | null;
  channelAvatar: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ActiveGeneration = { id: string; assistantMessageId: string | null; kind: string; startedAt: string };

export type ChatThreadResponse = {
  chat: ChatMeta;
  messages: ChatMessageDTO[];
  attachments: ChatAttachment[];
  activeGeneration: ActiveGeneration | null;
};

export type PinnedTitle = {
  id: string;
  title: string;
  chatId: string | null;
  messageId: string | null;
  projectId: string | null;
  angle: string | null;
  clickTrigger: string | null;
  cardKey: string | null;
  createdAt: string;
};

export type StageName = "_preparing" | "_routing" | "_loading_context" | "_deep_research" | "_generating";

export type Canonical =
  | {
      version: string;
      type: "cards";
      payload: { angleCards?: AngleCard[]; thumbnailTexts?: ThumbnailText[]; bodyMarkdown?: string };
      summary?: string;
      suggestedFollowups: string[];
    }
  | { version: string; type: "markdown"; payload: { markdown: string }; summary?: string; suggestedFollowups: string[] }
  | {
      version: string;
      type: "titles";
      payload: { messageId: string; cardId: string; batch: CardExpansionBatch };
      summary?: string;
      suggestedFollowups: string[];
    };

/** Every SSE event is `data: <json>\n\n` with "version":"1.0". */
export type StreamEvent =
  | { version: string; tool_status: "executing"; tool_name: StageName; intent?: Intent }
  | { version: string; title: ChatTitle }
  | { version: string; card: AngleCard }
  | { version: string; thumbnail_text: ThumbnailText }
  | { version: string; text_delta: string }
  | { version: string; chat_title: string }
  | { version: string; error: string; code?: string }
  | {
      version: string;
      done: true;
      cancelled?: boolean;
      messageId: string;
      canonical: Canonical | null;
      metadata: Record<string, unknown>;
      videoMap: VideoMap;
      credits?: number;
    };
