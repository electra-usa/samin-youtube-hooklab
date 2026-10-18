"use client";

// Window events that keep independent client components in sync
// (the original dispatches the same kind of "chats updated" signal).
export const CHATS_UPDATED = "hooklab:chats-updated";
export const BOOKMARKS_UPDATED = "hooklab:bookmarks-updated";
export const CHANNEL_SWITCHED = "hooklab:channel-switched";
export const PROJECTS_UPDATED = "hooklab:projects-updated";
export const CHANNELS_UPDATED = "hooklab:channels-updated";

export function emit(name: string, detail?: unknown) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export const notifyChatsUpdated = () => emit(CHATS_UPDATED);
