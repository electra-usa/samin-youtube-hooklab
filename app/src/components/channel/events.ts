"use client";

// Ask the "New Trophy" popup to re-check for unseen trophies (after a sync finishes).
export const TROPHY_REFRESH = "hooklab:trophy-refresh";

export const emitTrophyRefresh = () => window.dispatchEvent(new CustomEvent(TROPHY_REFRESH));
