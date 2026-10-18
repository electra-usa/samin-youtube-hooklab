import "server-only";
import { appDb } from "@/lib/db/app";
import type { MessageCards } from "./types";
import { DEFAULT_PILLS, FIXED_PILL } from "./default-pills";

// Prompt pills for the new-chat page (HookLab's own set, see default-pills.ts).

export type PromptPill = {
  id: string;
  label: string;
  prompt: string;
  canned: { response: string; cards?: MessageCards } | null;
};

export function loadPromptPills(): { fixed: PromptPill; pills: PromptPill[] } {
  return { fixed: FIXED_PILL, pills: DEFAULT_PILLS };
}

function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The 3 pills after "Generate titles": capabilities pinned for new users, the rest random. */
export function pickPills(pills: PromptPill[], pinCapabilities: boolean): PromptPill[] {
  const capabilities = pills.find((p) => p.id === "chat_capabilities");
  if (pinCapabilities && capabilities) return [capabilities, ...shuffle(pills.filter((p) => p !== capabilities)).slice(0, 2)];
  return shuffle(pills).slice(0, 3);
}

/** New users (no chats yet) always see the "what can this chat do" pill. */
export function isNewChatUser(): boolean {
  const row = appDb().prepare("SELECT count(*) AS n FROM chats").get() as { n: number };
  return row.n === 0;
}
