import "server-only";
import { activeChannel, appDb, listUserChannels, newId, nowIso } from "@/lib/db/app";
import { defaultChatTitle } from "./constants";
import type {
  ActiveGeneration,
  AttachmentRef,
  ChatAttachment,
  ChatMessageDTO,
  ChatMeta,
  MessageCards,
  MessageFeedback,
  MessageMeta,
  PinnedTitle,
  PromptPillMeta,
} from "./types";

// Persistence for chats, messages, attachments, generations and pins (data/app.db).

let ensured = false;
/** Chat-owned table not in the shared schema: one row per streamed generation (for cancel/resume). */
export function ensureChatTables() {
  if (ensured) return;
  appDb().exec(`
    CREATE TABLE IF NOT EXISTS chat_generations (
      id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, assistant_message_id TEXT, target_message_id TEXT,
      kind TEXT NOT NULL DEFAULT 'message', status TEXT NOT NULL, cancel_reason TEXT,
      provider TEXT, model TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS chat_generations_chat ON chat_generations(chat_id, created_at);
  `);
  ensured = true;
}

const parse = <T>(s: unknown): T | null => {
  if (typeof s !== "string" || !s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

type ChatRow = {
  id: string;
  title: string;
  user_channel_id: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
};

export function getChatRow(id: string): ChatRow | null {
  return (appDb().prepare("SELECT * FROM chats WHERE id = ?").get(id) as ChatRow | undefined) ?? null;
}

export function chatMeta(row: ChatRow): ChatMeta {
  const db = appDb();
  const project = row.project_id
    ? (db.prepare("SELECT name FROM projects WHERE id = ?").get(row.project_id) as { name: string } | undefined)
    : undefined;
  const channel = listUserChannels().find((c) => c.id === row.user_channel_id) ?? null;
  return {
    id: row.id,
    title: row.title,
    projectId: project ? row.project_id : null,
    projectName: project?.name ?? null,
    channelId: channel?.id ?? row.user_channel_id,
    channelName: channel?.name ?? null,
    channelAvatar: channel?.avatar ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Resolve a channel id from a request (user_channels.id or YouTube channel id) to user_channels.id. */
export function resolveUserChannelId(channelId: unknown): string | null {
  const channels = listUserChannels();
  if (typeof channelId === "string" && channelId) {
    const hit = channels.find((c) => c.id === channelId || c.channelId === channelId);
    if (hit) return hit.id;
  }
  return activeChannel()?.id ?? null;
}

export function createChat(args: { title: string; userChannelId: string | null; projectId?: string | null }): string {
  const id = newId();
  const now = nowIso();
  appDb()
    .prepare("INSERT INTO chats (id, title, user_channel_id, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, args.title, args.userChannelId, args.projectId ?? null, now, now);
  return id;
}

export function renameChat(id: string, title: string) {
  appDb().prepare("UPDATE chats SET title = ? WHERE id = ?").run(title, id);
}

export function setChatProject(id: string, projectId: string | null) {
  appDb().prepare("UPDATE chats SET project_id = ? WHERE id = ?").run(projectId, id);
}

export function touchChat(id: string) {
  appDb().prepare("UPDATE chats SET updated_at = ? WHERE id = ?").run(nowIso(), id);
}

export function deleteChat(id: string) {
  const db = appDb();
  ensureChatTables();
  db.exec("BEGIN");
  try {
    const pins = db.prepare("SELECT id FROM pinned_titles WHERE chat_id = ?").all(id) as { id: string }[];
    for (const p of pins) db.prepare("DELETE FROM project_items WHERE kind = 'title' AND ref_id = ?").run(p.id);
    db.prepare("DELETE FROM pinned_titles WHERE chat_id = ?").run(id);
    db.prepare("DELETE FROM project_items WHERE kind = 'chat' AND ref_id = ?").run(id);
    db.prepare("DELETE FROM title_feedback WHERE message_id IN (SELECT id FROM chat_messages WHERE chat_id = ?)").run(id);
    db.prepare("DELETE FROM chat_attachments WHERE chat_id = ?").run(id);
    db.prepare("DELETE FROM chat_messages WHERE chat_id = ?").run(id);
    db.prepare("DELETE FROM chat_generations WHERE chat_id = ?").run(id);
    db.prepare("DELETE FROM chats WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** True while the chat still has the automatic title derived from its first message. */
export function hasAutoTitle(chatId: string): boolean {
  const row = getChatRow(chatId);
  if (!row) return false;
  const first = appDb()
    .prepare("SELECT content FROM chat_messages WHERE chat_id = ? AND role = 'user' ORDER BY created_at ASC LIMIT 1")
    .get(chatId) as { content: string } | undefined;
  return row.title === "New chat" || row.title === "Untitled" || (!!first && row.title === defaultChatTitle(first.content));
}

type MessageRow = {
  id: string;
  chat_id: string;
  role: string;
  content: string;
  cards_json: string | null;
  metadata_json: string | null;
  attachments_json: string | null;
  prompt_pill_json: string | null;
  feedback: string | null;
  created_at: string;
};

function toMessage(r: MessageRow): ChatMessageDTO {
  return {
    id: r.id,
    role: r.role === "user" ? "user" : "assistant",
    content: r.content,
    cards: parse<MessageCards>(r.cards_json),
    metadata: parse<MessageMeta>(r.metadata_json),
    attachments: parse<AttachmentRef[]>(r.attachments_json),
    promptPill: parse<PromptPillMeta>(r.prompt_pill_json),
    feedback: parse<MessageFeedback>(r.feedback),
    createdAt: r.created_at,
  };
}

export function listMessages(chatId: string): ChatMessageDTO[] {
  const rows = appDb()
    .prepare("SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY created_at ASC, rowid ASC")
    .all(chatId) as MessageRow[];
  return rows.map(toMessage);
}

export function getMessage(id: string): (ChatMessageDTO & { chatId: string }) | null {
  const r = appDb().prepare("SELECT * FROM chat_messages WHERE id = ?").get(id) as MessageRow | undefined;
  return r ? { ...toMessage(r), chatId: r.chat_id } : null;
}

// Timestamps must stay strictly increasing within a chat so ordering survives same-millisecond inserts.
function nextTimestamp(chatId: string): string {
  const last = appDb()
    .prepare("SELECT max(created_at) AS t FROM chat_messages WHERE chat_id = ?")
    .get(chatId) as { t: string | null };
  const now = Date.now();
  const lastMs = last.t ? new Date(last.t).getTime() : 0;
  return new Date(Math.max(now, lastMs + 1)).toISOString();
}

export function insertMessage(args: {
  id?: string;
  chatId: string;
  role: "user" | "assistant";
  content: string;
  cards?: MessageCards | null;
  metadata?: MessageMeta | null;
  attachments?: AttachmentRef[] | null;
  promptPill?: PromptPillMeta | null;
}): string {
  const id = args.id ?? newId();
  appDb()
    .prepare(
      `INSERT INTO chat_messages (id, chat_id, role, content, cards_json, metadata_json, attachments_json, prompt_pill_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      args.chatId,
      args.role,
      args.content,
      args.cards ? JSON.stringify(args.cards) : null,
      args.metadata ? JSON.stringify(args.metadata) : null,
      args.attachments?.length ? JSON.stringify(args.attachments) : null,
      args.promptPill ? JSON.stringify(args.promptPill) : null,
      nextTimestamp(args.chatId),
    );
  touchChat(args.chatId);
  return id;
}

export function updateMessageCards(id: string, cards: MessageCards) {
  appDb().prepare("UPDATE chat_messages SET cards_json = ? WHERE id = ?").run(JSON.stringify(cards), id);
}

export function updateMessageMeta(id: string, meta: MessageMeta) {
  appDb().prepare("UPDATE chat_messages SET metadata_json = ? WHERE id = ?").run(JSON.stringify(meta), id);
}

export function setMessageFeedback(id: string, feedback: MessageFeedback | null) {
  appDb().prepare("UPDATE chat_messages SET feedback = ? WHERE id = ?").run(feedback ? JSON.stringify(feedback) : null, id);
}

// ---------------------------------------------------------------- attachments

type AttachmentRow = {
  id: string;
  chat_id: string | null;
  kind: string;
  name: string | null;
  content: string | null;
  meta_json: string | null;
  created_at: string;
};

type AttachmentMetaJson = { sourceType?: ChatAttachment["sourceType"]; sourceUrl?: string | null; sourceVideoId?: string | null };

function toAttachment(r: AttachmentRow): ChatAttachment {
  const meta = parse<AttachmentMetaJson>(r.meta_json) ?? {};
  return {
    id: r.id,
    type: r.kind === "document" ? "document" : "transcript",
    sourceType: meta.sourceType ?? "pasted",
    status: "ready",
    label: r.name,
    sourceUrl: meta.sourceUrl ?? null,
    sourceVideoId: meta.sourceVideoId ?? null,
    transcriptText: r.content,
    charCount: r.content?.length ?? 0,
    createdAt: r.created_at,
  };
}

export function listAttachments(chatId: string): ChatAttachment[] {
  const rows = appDb()
    .prepare("SELECT * FROM chat_attachments WHERE chat_id = ? ORDER BY created_at ASC")
    .all(chatId) as AttachmentRow[];
  return rows.map(toAttachment);
}

export function getAttachment(id: string): (ChatAttachment & { chatId: string | null }) | null {
  const r = appDb().prepare("SELECT * FROM chat_attachments WHERE id = ?").get(id) as AttachmentRow | undefined;
  return r ? { ...toAttachment(r), chatId: r.chat_id } : null;
}

export function insertAttachment(chatId: string, a: Omit<ChatAttachment, "id" | "createdAt" | "charCount" | "status">): ChatAttachment {
  const id = newId();
  const now = nowIso();
  appDb()
    .prepare("INSERT INTO chat_attachments (id, chat_id, kind, name, content, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(
      id,
      chatId,
      a.type,
      a.label,
      a.transcriptText,
      JSON.stringify({ sourceType: a.sourceType, sourceUrl: a.sourceUrl, sourceVideoId: a.sourceVideoId }),
      now,
    );
  return getAttachment(id)!;
}

export function updateAttachmentLabel(id: string, label: string | null) {
  appDb().prepare("UPDATE chat_attachments SET name = ? WHERE id = ?").run(label, id);
}

export function deleteAttachment(id: string) {
  appDb().prepare("DELETE FROM chat_attachments WHERE id = ?").run(id);
}

// ---------------------------------------------------------------- generations

const STALE_MS = 10 * 60_000;

export function insertGeneration(args: {
  id: string;
  chatId: string;
  assistantMessageId: string;
  targetMessageId: string | null;
  kind: "message" | "expansion";
  provider: string | null;
  model: string | null;
}) {
  ensureChatTables();
  const now = nowIso();
  appDb()
    .prepare(
      `INSERT INTO chat_generations (id, chat_id, assistant_message_id, target_message_id, kind, status, provider, model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)`,
    )
    .run(args.id, args.chatId, args.assistantMessageId, args.targetMessageId, args.kind, args.provider, args.model, now, now);
}

export function setGenerationStatus(id: string, status: "running" | "cancel_requested" | "completed" | "cancelled" | "failed", reason?: string) {
  ensureChatTables();
  const now = nowIso();
  const done = status === "completed" || status === "cancelled" || status === "failed";
  appDb()
    .prepare(
      `UPDATE chat_generations SET status = ?, cancel_reason = COALESCE(?, cancel_reason), updated_at = ?,
       completed_at = CASE WHEN ? THEN ? ELSE completed_at END WHERE id = ?`,
    )
    .run(status, reason ?? null, now, done ? 1 : 0, now, id);
}

export function getGeneration(id: string) {
  ensureChatTables();
  return (
    (appDb().prepare("SELECT * FROM chat_generations WHERE id = ?").get(id) as
      | { id: string; chat_id: string; status: string; assistant_message_id: string | null; kind: string; created_at: string }
      | undefined) ?? null
  );
}

/** The chat's in-flight generation, ignoring rows orphaned by a server restart. */
export function activeGeneration(chatId: string): ActiveGeneration | null {
  ensureChatTables();
  const row = appDb()
    .prepare(
      `SELECT * FROM chat_generations WHERE chat_id = ? AND status IN ('running', 'cancel_requested')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(chatId) as { id: string; assistant_message_id: string | null; kind: string; created_at: string } | undefined;
  if (!row || Date.now() - new Date(row.created_at).getTime() > STALE_MS) return null;
  return { id: row.id, assistantMessageId: row.assistant_message_id, kind: row.kind, startedAt: row.created_at };
}

// ---------------------------------------------------------------- pins

type PinRow = {
  id: string;
  title: string;
  chat_id: string | null;
  message_id: string | null;
  project_id: string | null;
  meta_json: string | null;
  created_at: string;
};

function toPin(r: PinRow): PinnedTitle {
  const meta = parse<{ angle?: string; clickTrigger?: string; cardKey?: string }>(r.meta_json) ?? {};
  return {
    id: r.id,
    title: r.title,
    chatId: r.chat_id,
    messageId: r.message_id,
    projectId: r.project_id,
    angle: meta.angle ?? null,
    clickTrigger: meta.clickTrigger ?? null,
    cardKey: meta.cardKey ?? null,
    createdAt: r.created_at,
  };
}

export function listPins(chatId?: string | null): PinnedTitle[] {
  const db = appDb();
  const rows = (
    chatId
      ? db.prepare("SELECT * FROM pinned_titles WHERE chat_id = ? ORDER BY created_at DESC").all(chatId)
      : db.prepare("SELECT * FROM pinned_titles ORDER BY created_at DESC LIMIT 500").all()
  ) as PinRow[];
  return rows.map(toPin);
}

export function getPin(id: string): PinnedTitle | null {
  const r = appDb().prepare("SELECT * FROM pinned_titles WHERE id = ?").get(id) as PinRow | undefined;
  return r ? toPin(r) : null;
}
