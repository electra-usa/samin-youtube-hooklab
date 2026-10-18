import Link from "next/link";

// Shown on My Channel when no channel has been added yet (original copy).
export function MyChannelEmptyState() {
  return (
    <div className="rounded-xl border border-stroke bg-gray-100 py-12 text-center dark:border-white/10 dark:bg-white/5">
      <p className="mb-4 text-[var(--color-muted)]">Add a channel to view your videos here.</p>
      <Link
        href="/settings?tab=channels"
        className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white transition hover:bg-primary-hover"
      >
        Add channel
      </Link>
    </div>
  );
}
