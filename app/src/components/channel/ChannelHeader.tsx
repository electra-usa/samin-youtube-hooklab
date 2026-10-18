import type { ReactNode } from "react";
import { cn } from "@/lib/format";

// Avatar + name block shared by My Channel and the Trophy Case (same markup in the original).

/** White bordered button used for "Trophy Case", "Back to My Channel" and "How trophies work". */
export const outlineButtonClass =
  "inline-flex items-center justify-center gap-2.5 rounded-lg border border-stroke bg-white px-4 py-2.5 text-center font-medium text-dark transition hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 dark:border-white/15 dark:bg-transparent dark:text-white dark:hover:bg-white/10";

export function ChannelAvatar({ src, name, className }: { src: string | null; name: string; className?: string }) {
  return (
    <div className={cn("relative size-20 shrink-0 overflow-hidden rounded-full bg-[#e8e8e8] dark:bg-dark-3 sm:size-24", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center text-2xl font-semibold text-[var(--color-muted)]" aria-hidden>
          {name.slice(0, 2).toUpperCase()}
        </div>
      )}
    </div>
  );
}

export function ChannelHeader({
  avatar,
  name,
  eyebrow,
  headingLevel = "h2",
  meta,
  below,
  action,
}: {
  avatar: string | null;
  name: string;
  eyebrow?: ReactNode;
  headingLevel?: "h1" | "h2";
  meta: ReactNode;
  below?: ReactNode;
  action?: ReactNode;
}) {
  const Heading = headingLevel;
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
      <ChannelAvatar src={avatar} name={name} />
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="mb-1 text-sm font-medium text-[var(--color-muted)]">{eyebrow}</p>}
        <Heading className="truncate text-xl font-bold text-dark dark:text-white sm:text-2xl">{name}</Heading>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--color-muted)]">{meta}</div>
        {below}
      </div>
      {action && <div className="sm:self-start">{action}</div>}
    </div>
  );
}
