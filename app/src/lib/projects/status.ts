// Project statuses (original enum: IDEA / IN_PROGRESS / PUBLISHED). Stored and sent in
// lowercase, which is also the original's `?status=` URL form.
export type ProjectStatus = "idea" | "in_progress" | "published";

export const PROJECT_STATUSES: { value: ProjectStatus; label: string; chipClass: string }[] = [
  {
    value: "idea",
    label: "Idea",
    chipClass:
      "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:border-purple-400/30 dark:bg-purple-400/15 dark:text-purple-300",
  },
  {
    value: "in_progress",
    label: "In progress",
    chipClass:
      "border-accent-blue/30 bg-accent-blue/10 text-accent-blue-text dark:border-accent-blue/40 dark:bg-accent-blue/15 dark:text-accent-blue",
  },
  {
    value: "published",
    label: "Published",
    chipClass:
      "border-green-600/30 bg-green-600/10 text-green-700 dark:border-green-400/30 dark:bg-green-400/15 dark:text-green-300",
  },
];

/** Accepts "in_progress", "IN_PROGRESS", "in progress" or "in-progress". */
export function normalizeStatus(value: unknown): ProjectStatus | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return v === "idea" || v === "in_progress" || v === "published" ? v : null;
}

export function statusOption(value: string | null | undefined) {
  return PROJECT_STATUSES.find((o) => o.value === normalizeStatus(value)) ?? PROJECT_STATUSES[0];
}
