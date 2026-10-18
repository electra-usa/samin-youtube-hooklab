"use client";

import { useState, type ReactNode } from "react";
import { Monitor, Search, Smartphone, Tv } from "lucide-react";
import { cn } from "@/lib/format";
import type { Combo, StyleSettings } from "./model";
import { ComboCard } from "./ComboCard";
import { ThumbnailPlaceholder, ThumbnailText } from "./ThumbnailText";

export type ComboWithStyle = Combo & { style: StyleSettings };

export function ViewIntro({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl bg-white p-4 dark:bg-transparent sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="mb-1 text-lg font-semibold text-dark dark:text-white">{title}</h2>
        <div className="text-sm text-[var(--color-muted)]">{children}</div>
      </div>
      {aside && <div className="flex flex-shrink-0 flex-wrap items-center gap-3">{aside}</div>}
    </div>
  );
}

export function EmptyCombos({ message, onGoToWorkspace }: { message: string; onGoToWorkspace: () => void }) {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center rounded-xl border border-dashed border-stroke bg-white p-8 dark:border-white/15 dark:bg-[#18191c]">
      <h3 className="mb-2 text-lg font-semibold text-dark dark:text-white">No combos yet</h3>
      <p className="mb-4 text-center text-sm text-[var(--color-muted)]">{message}</p>
      <button
        type="button"
        onClick={onGoToWorkspace}
        className="rounded-lg border border-stroke bg-white px-4 py-2 text-sm font-medium text-dark transition hover:bg-gray-100 dark:border-white/15 dark:bg-transparent dark:text-white dark:hover:bg-white/10"
      >
        Go to Workspace
      </button>
    </div>
  );
}

/** Segmented control used across the Studio tabs. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  variant = "soft",
  className,
}: {
  options: { id: T; label: ReactNode; title?: string; disabled?: boolean }[];
  value: T;
  onChange: (id: T) => void;
  variant?: "soft" | "solid";
  className?: string;
}) {
  return (
    <div className={cn("inline-flex rounded-lg border border-stroke p-1 dark:border-white/15", className)} role="group">
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            title={o.title}
            disabled={o.disabled}
            aria-pressed={active}
            onClick={() => onChange(o.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              active
                ? variant === "solid"
                  ? "bg-primary text-white shadow-sm dark:bg-sky-300 dark:text-dark"
                  : "bg-white text-dark shadow-sm dark:bg-white/15 dark:text-white"
                : "text-[var(--color-muted)] hover:text-dark dark:hover:text-white",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

type Device = "mobile" | "desktop" | "search" | "tv";

const DEVICES: Record<Device, { label: string; icon: typeof Smartphone; description: string; grid: string; card: string; lines: 1 | 2; avatar: number }> = {
  mobile: {
    label: "Mobile",
    icon: Smartphone,
    description: "YouTube app on phone. Single column, compact metadata.",
    grid: "max-w-[400px] grid-cols-1",
    card: "max-w-[360px]",
    lines: 2,
    avatar: 28,
  },
  desktop: {
    label: "Desktop",
    icon: Monitor,
    description: "YouTube homepage on desktop. Multi-column grid, standard sizing.",
    grid: "grid-cols-1 sm:grid-cols-[repeat(auto-fit,340px)] sm:justify-center",
    card: "max-w-[340px]",
    lines: 2,
    avatar: 36,
  },
  search: {
    label: "Search",
    icon: Search,
    description: "YouTube search results on desktop. Horizontal layout with thumbnail on the left.",
    grid: "max-w-[820px] grid-cols-1",
    card: "",
    lines: 2,
    avatar: 24,
  },
  tv: {
    label: "TV",
    icon: Tv,
    description: "YouTube on Smart TV. Large cards, single-line titles, minimal metadata.",
    grid: "max-w-[1100px] grid-cols-1 sm:grid-cols-[repeat(auto-fit,500px)] sm:justify-center",
    card: "max-w-[500px]",
    lines: 1,
    avatar: 40,
  },
};

function SearchResultCard({ combo, channelName, channelAvatarUrl }: { combo: ComboWithStyle; channelName: string; channelAvatarUrl: string | null }) {
  return (
    <article className="flex gap-4 rounded-xl border border-stroke bg-white p-3 shadow-sm dark:border-white/10 dark:bg-[#18191c]">
      <div className="@container relative aspect-video w-[360px] shrink-0 overflow-hidden rounded-lg bg-[#e8e8e8] dark:bg-dark-3">
        {combo.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={combo.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <ThumbnailPlaceholder />
        )}
        <ThumbnailText text={combo.thumbnailText} style={combo.style} />
        <span className="font-roboto absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium text-white" aria-hidden>
          12:34
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
        <h3 className="font-roboto line-clamp-2 text-lg font-medium leading-snug text-dark dark:text-white">{combo.title || "Untitled"}</h3>
        <div className="flex items-center gap-2">
          {channelAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={channelAvatarUrl} alt="" className="size-6 rounded-full object-cover" />
          ) : (
            <div className="size-6 rounded-full bg-[#e8e8e8] dark:bg-dark-3" aria-hidden />
          )}
          <span className="font-roboto text-sm text-[var(--color-muted)]">{channelName}</span>
          <span className="font-roboto text-sm text-[var(--color-muted)]">· 100K views · 1 day ago</span>
        </div>
        <p className="font-roboto line-clamp-2 text-sm text-[var(--color-muted)]">
          Description preview not available. This area shows the video description snippet on YouTube search results.
        </p>
      </div>
    </article>
  );
}

export function DevicesView({
  combos,
  channelName,
  channelAvatarUrl,
  onGoToWorkspace,
}: {
  combos: ComboWithStyle[];
  channelName: string;
  channelAvatarUrl: string | null;
  onGoToWorkspace: () => void;
}) {
  const [device, setDevice] = useState<Device>("mobile");
  if (!combos.length) return <EmptyCombos message="Add titles and thumbnails in the Workspace to get started." onGoToWorkspace={onGoToWorkspace} />;
  const d = DEVICES[device];
  return (
    <div className="space-y-6">
      <ViewIntro
        title="Devices"
        aside={
          <Segmented
            variant="solid"
            value={device}
            onChange={setDevice}
            options={(Object.keys(DEVICES) as Device[]).map((id) => {
              const Icon = DEVICES[id].icon;
              return {
                id,
                label: (
                  <>
                    <Icon className="size-4" aria-hidden />
                    {DEVICES[id].label}
                  </>
                ),
              };
            })}
          />
        }
      >
        {d.description}
      </ViewIntro>
      {device === "search" ? (
        <div className="mx-auto flex max-w-[820px] flex-col gap-4">
          {combos.map((c, i) => (
            <SearchResultCard key={`${c.id}-${i}`} combo={c} channelName={channelName} channelAvatarUrl={channelAvatarUrl} />
          ))}
        </div>
      ) : (
        <div className={cn("mx-auto grid justify-items-center gap-4", d.grid)}>
          {combos.map((c, i) => (
            <ComboCard
              key={`${device}-${c.id}-${i}`}
              title={c.title}
              thumbnailText={c.thumbnailText}
              imageUrl={c.imageUrl || null}
              channelName={channelName}
              channelAvatarUrl={channelAvatarUrl}
              style={c.style}
              className={cn("w-full", d.card)}
              titleLineClamp={d.lines}
              avatarSize={d.avatar}
              disableScale
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function TinyTestView({ combos, channelAvatarUrl, onGoToWorkspace }: { combos: ComboWithStyle[]; channelAvatarUrl: string | null; onGoToWorkspace: () => void }) {
  if (!combos.length) return <EmptyCombos message="Add titles and thumbnails in the Workspace to get started." onGoToWorkspace={onGoToWorkspace} />;
  return (
    <div className="space-y-6">
      <ViewIntro title="Tiny Test">
        View small versions of your thumbnails to see which grab your attention most. This highlights which details stand out, which
        blend in, and what&apos;s hard or easy to notice at a glance.
      </ViewIntro>
      <div className="flex justify-center">
        <div className="grid w-max max-w-full grid-cols-3 justify-items-center gap-x-8 gap-y-6 sm:grid-cols-4 sm:gap-x-4 md:gap-y-8">
          {combos.map((c, i) => (
            <div key={`tiny-${c.id}-${i}`} className="flex w-20 flex-col gap-1">
              <div className="@container relative aspect-video w-full overflow-hidden rounded-sm bg-[#e8e8e8] dark:bg-dark-3">
                {c.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <ThumbnailPlaceholder />
                )}
                <ThumbnailText text={c.thumbnailText} style={c.style} fontPx={(80 * (c.style.fontSize || 24)) / 320} compact />
              </div>
              <div className="flex w-full gap-1">
                {channelAvatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={channelAvatarUrl} alt="" className="size-[9px] shrink-0 rounded-full object-cover" />
                ) : (
                  <div className="size-[9px] shrink-0 rounded-full bg-[#e8e8e8] dark:bg-dark-3" aria-hidden />
                )}
                <h3 className="line-clamp-3 min-w-0 flex-1 text-[4px] leading-[1.2] text-dark dark:text-white">{c.title || "Untitled"}</h3>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function BlurTestView({
  combos,
  channelName,
  channelAvatarUrl,
  onGoToWorkspace,
}: {
  combos: ComboWithStyle[];
  channelName: string;
  channelAvatarUrl: string | null;
  onGoToWorkspace: () => void;
}) {
  if (!combos.length)
    return <EmptyCombos message="Add titles and thumbnails in the Workspace, then come back to test them." onGoToWorkspace={onGoToWorkspace} />;
  return (
    <div className="space-y-6">
      <ViewIntro title="Blur Test">
        View blurred versions of your thumbnails to see what stands out. This simulates your audience viewing your thumbnail in their
        peripheral vision as they&apos;re scanning other thumbnails.
      </ViewIntro>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fit,minmax(300px,380px))] sm:justify-center">
        {combos.map((c, i) => (
          <ComboCard
            key={`blur-${c.id}-${i}`}
            title={c.title}
            thumbnailText={c.thumbnailText}
            imageUrl={c.imageUrl || null}
            channelName={channelName}
            channelAvatarUrl={channelAvatarUrl}
            style={c.style}
            className="max-w-[380px]"
            blurThumbnail
          />
        ))}
      </div>
    </div>
  );
}
