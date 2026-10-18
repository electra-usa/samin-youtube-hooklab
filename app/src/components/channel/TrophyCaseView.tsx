"use client";

import Link from "next/link";
import { useState } from "react";
import { Trophy as TrophyIcon } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { cn, formatDate, timeAgo } from "@/lib/format";
import type { ChannelSummary } from "@/lib/channel/videos";
import {
  compactViews,
  eligibilitySentences,
  heroMilestone,
  milestoneTitle,
  type Trophy,
  type TrophyEligibility,
  type TrophyTarget,
} from "@/lib/channel/trophy-format";
import { ChannelHeader, outlineButtonClass } from "./ChannelHeader";
import { TrophyArtwork } from "./TrophyArtwork";
import { TrophyShareButton } from "./TrophyShareButton";

function Thumb({ src, className }: { src: string | null; className: string }) {
  return (
    <div className={cn("relative aspect-video shrink-0 overflow-hidden bg-[#e5e9ea] dark:bg-dark-3", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />}
    </div>
  );
}

function EarnedTrophyCard({ trophy, channelName }: { trophy: Trophy; channelName: string }) {
  const meta = [
    trophy.currentViews != null ? `${compactViews(trophy.currentViews)} views` : null,
    trophy.videoPublishAt ? timeAgo(trophy.videoPublishAt) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-3xl border border-stroke bg-white shadow-sm dark:border-white/10 dark:bg-[#18191c]">
      <div className="relative p-3 pb-0">
        <TrophyArtwork milestone={trophy.milestone} title={trophy.title} size="card" />
      </div>
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary dark:text-white">{formatDate(trophy.earnedAt)}</p>
          <TrophyShareButton trophy={trophy} channelName={channelName} className="shrink-0" />
        </div>
        <div className="flex items-center gap-3">
          <Thumb src={trophy.videoThumbnail} className="w-20 rounded-lg" />
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm font-medium text-dark dark:text-white">{trophy.videoTitle}</p>
            {meta && <p className="mt-1 truncate text-xs text-[var(--color-muted)]">{meta}</p>}
          </div>
        </div>
      </div>
    </article>
  );
}

function UpcomingTrophyCard({ target }: { target: TrophyTarget }) {
  return (
    <article className="rounded-3xl border border-dashed border-stroke bg-white p-4 dark:border-white/15 dark:bg-[#18191c]">
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr] sm:items-center">
        <TrophyArtwork milestone={target.milestone} title={target.title} size="compact" muted className="min-h-40" />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-lg font-bold text-dark dark:text-white">{target.title}</p>
          <Link
            href={`/my-channel/${target.videoId}`}
            className="mt-3 flex items-start gap-3 rounded-2xl bg-gray-50 p-2.5 transition hover:bg-gray-100 dark:bg-white/5 dark:hover:bg-white/10"
          >
            <Thumb src={target.videoThumbnail} className="w-24 rounded-xl" />
            <div className="min-w-0">
              <p className="line-clamp-2 text-sm font-medium text-dark dark:text-white">{target.videoTitle}</p>
              {target.publishAt && <p className="mt-1 text-xs text-[var(--color-muted)]">{timeAgo(target.publishAt)}</p>}
            </div>
          </Link>
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs text-[var(--color-muted)]">
              <span>{target.currentLabel}</span>
              <span>{target.targetLabel}</span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10"
              role="progressbar"
              aria-valuenow={Math.round(target.progress)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${target.title} progress`}
            >
              <div className="h-full rounded-full bg-primary dark:bg-sky-300" style={{ width: `${target.progress}%` }} />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function HowTrophiesWorkModal({ open, onClose, eligibility }: { open: boolean; onClose: () => void; eligibility: TrophyEligibility }) {
  return (
    <Modal open={open} onClose={onClose} title="How Trophies Work">
      <ul className="space-y-3 text-sm leading-relaxed text-[var(--color-muted)]">
        <li className="flex gap-2">
          <span aria-hidden>•</span>
          <span>Trophies are awarded when a video crosses a meaningful milestone after you&apos;ve added your channel in HookLab.</span>
        </li>
        {eligibilitySentences(eligibility).map((s) => (
          <li key={s.key} className="flex gap-2">
            <span aria-hidden>•</span>
            <span>
              {s.label && <strong className="text-dark dark:text-white">{s.label}: </strong>}
              {s.sentence}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function TrophyCaseView({
  channel,
  trophies,
  nextTargets,
  eligibility,
}: {
  channel: ChannelSummary;
  trophies: Trophy[];
  nextTargets: TrophyTarget[];
  eligibility: TrophyEligibility;
}) {
  const [howOpen, setHowOpen] = useState(false);
  const hero = heroMilestone(eligibility, nextTargets);

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-8">
      <ChannelHeader
        avatar={channel.channelAvatar}
        name={channel.channelName}
        eyebrow="Trophy Case"
        headingLevel="h1"
        meta={
          <span className="inline-flex items-center gap-1.5">
            <TrophyIcon className="size-4" aria-hidden />
            {trophies.length} {trophies.length === 1 ? "trophy" : "trophies"}
          </span>
        }
        action={
          <Link href="/my-channel" className={cn(outlineButtonClass, "w-full sm:w-auto")}>
            Back to My Channel
          </Link>
        }
      />

      {trophies.length ? (
        <section>
          <div className="mb-4 flex items-end justify-between gap-4">
            <h2 className="text-xl font-bold text-dark dark:text-white">Earned Trophies</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {trophies.map((t) => (
              <EarnedTrophyCard key={t.id} trophy={t} channelName={channel.channelName} />
            ))}
          </div>
        </section>
      ) : (
        <section className="grid gap-6 rounded-3xl border border-stroke bg-white p-5 dark:border-white/10 dark:bg-[#18191c] md:grid-cols-[20rem_1fr] md:items-center md:p-8">
          <TrophyArtwork milestone={hero} title={milestoneTitle(hero)} size="hero" muted />
          <div>
            <h2 className="text-2xl font-bold text-dark dark:text-white">Your first trophy is waiting</h2>
            <p className="mt-3 max-w-2xl text-sm text-[var(--color-muted)]">
              Trophies unlock when a video crosses a meaningful view milestone after signup.
            </p>
          </div>
        </section>
      )}

      <section>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-xl font-bold text-dark dark:text-white">Upcoming Trophies</h2>
          <button type="button" onClick={() => setHowOpen(true)} className={cn(outlineButtonClass, "w-full py-2 sm:w-auto")}>
            <TrophyIcon className="size-4" aria-hidden />
            How trophies work
          </button>
        </div>
        {nextTargets.length ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {nextTargets.map((t) => (
              <UpcomingTrophyCard key={t.id} target={t} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-stroke bg-white p-6 text-sm text-[var(--color-muted)] dark:border-white/10 dark:bg-[#18191c]">
            Sync your channel after publishing new videos to reveal the next trophies to chase.
          </div>
        )}
      </section>

      <HowTrophiesWorkModal open={howOpen} onClose={() => setHowOpen(false)} eligibility={eligibility} />
    </div>
  );
}
