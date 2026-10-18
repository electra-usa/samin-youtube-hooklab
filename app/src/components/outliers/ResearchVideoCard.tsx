"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Bookmark,
  BookmarkCheck,
  Copy,
  ExternalLink,
  FlaskConical,
  FolderPlus,
  Image as ImageIcon,
  Layers,
  MonitorPlay,
  MoreHorizontal,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { ChannelPill, ThumbAction, VideoCard } from "@/components/video/VideoCard";
import { Popover } from "@/components/ui/Popover";
import { chatHref, referenceSearchHref, remixPrompt, studioHref, type SearchMode } from "@/lib/research/filters";
import type { ResearchVideo } from "@/lib/research/types";
import { cn } from "@/lib/format";
import type { VideoActions } from "./useVideoActions";

function FollowPill({ followed, pending, onClick }: { followed: boolean; pending?: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <span className="flex-shrink-0" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <ChannelPill onClick={onClick} active={followed && !hover} tone={followed ? "danger" : "neutral"} disabled={pending}>
        {followed ? (hover ? "Unfollow" : "Following") : "Follow"}
      </ChannelPill>
    </span>
  );
}

function MenuRow({ icon, label, onClick, danger }: { icon: ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition",
        danger ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10" : "text-dark hover:bg-gray-50 dark:text-white dark:hover:bg-white/5",
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">{label}</span>
    </button>
  );
}

/** The "•••" menu (original VideoCardActionsMenu) plus HookLab's Studio preview and copy. */
export function VideoActionsMenu({
  video,
  actions,
  variant = "outliers",
  onReferenceSearch,
}: {
  video: ResearchVideo;
  actions: VideoActions;
  variant?: "outliers" | "following" | "bookmarks";
  onReferenceSearch?: (mode: SearchMode) => void;
}) {
  const router = useRouter();
  const similar = (mode: SearchMode) => (onReferenceSearch ? onReferenceSearch(mode) : router.push(referenceSearchHref(video.id, mode, video.title)));
  return (
    <Popover
      align="right"
      panelClassName="w-[22rem] max-w-[calc(100vw-2rem)] p-1"
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label="Video actions"
          title="Video actions"
          aria-expanded={open}
          className="flex items-center justify-center rounded p-1 text-dark-5 transition-colors hover:text-accent-blue-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-gray-400"
        >
          <MoreHorizontal className="size-4" />
        </button>
      )}
    >
      {(close) => {
        const run = (fn: () => void) => () => {
          close();
          fn();
        };
        return (
          <div role="menu">
            {variant === "bookmarks" ? (
              <>
                <MenuRow icon={<Plus className="size-4" />} label="Add tag" onClick={run(() => actions.openTagPicker(video))} />
                <MenuRow icon={<Trash2 className="size-4" />} label="Remove bookmark" danger onClick={run(() => void actions.removeBookmark(video))} />
              </>
            ) : video.isBookmarked ? (
              <>
                <MenuRow icon={<BookmarkCheck className="size-4" />} label="Manage bookmark" onClick={run(() => actions.manageBookmark(video))} />
                <MenuRow icon={<Trash2 className="size-4" />} label="Remove bookmark" danger onClick={run(() => void actions.removeBookmark(video))} />
              </>
            ) : (
              <MenuRow icon={<Bookmark className="size-4" />} label="Bookmark" onClick={run(() => void actions.bookmark(video))} />
            )}
            <MenuRow icon={<FolderPlus className="size-4" />} label="Add to a project" onClick={run(() => actions.addToProject(video))} />
            <MenuRow
              icon={<Sparkles className="size-4" />}
              label="Generate titles using this formula"
              onClick={run(() => router.push(chatHref(remixPrompt(video.title))))}
            />
            <MenuRow icon={<MonitorPlay className="size-4" />} label="Preview in Studio" onClick={run(() => router.push(studioHref(video.title, video.videoId)))} />
            <div role="group" aria-label="Find similar videos">
              <MenuRow icon={<Layers className="size-4" />} label="See similar topics" onClick={run(() => similar("topic"))} />
              <MenuRow icon={<FlaskConical className="size-4" />} label="See more videos that use this title formula" onClick={run(() => similar("title_pattern"))} />
              <MenuRow icon={<ImageIcon className="size-4" />} label="See similar thumbnails" onClick={run(() => similar("thumbnail"))} />
            </div>
            <div className="my-1 border-t border-stroke dark:border-white/10" role="separator" />
            <MenuRow icon={<Copy className="size-4" />} label="Copy title" onClick={run(() => void actions.copyTitle(video))} />
          </div>
        );
      }}
    </Popover>
  );
}

/** VideoCard wired with Follow / Hide pills, hover actions and the actions menu. */
export function ResearchVideoCard({
  video,
  followed,
  followPending,
  onToggleFollow,
  onHide,
  onChannelClick,
  onTriggerClick,
  activeTriggers,
  onFindSimilar,
  menu,
  footer,
  showSubscribers = true,
  showTriggers = true,
}: {
  video: ResearchVideo;
  followed: boolean;
  followPending?: boolean;
  onToggleFollow: () => void;
  onHide?: () => void;
  onChannelClick?: (channelId: string, channelName: string) => void;
  onTriggerClick?: (trigger: string) => void;
  activeTriggers?: string[];
  onFindSimilar?: () => void;
  menu: ReactNode;
  footer?: ReactNode;
  showSubscribers?: boolean;
  showTriggers?: boolean;
}) {
  const youtube = video.videoUrl || `https://www.youtube.com/watch?v=${video.videoId}`;
  return (
    <VideoCard
      video={{
        ...video,
        subscriberCount: showSubscribers ? video.subscriberCount : null,
        clickTriggers: showTriggers ? video.clickTriggers : [],
      }}
      className={video.isShort ? "[&_.aspect-video]:aspect-[9/16]" : undefined}
      onChannelClick={onChannelClick}
      onTriggerClick={onTriggerClick}
      activeTriggers={activeTriggers}
      channelActions={
        <>
          <FollowPill followed={followed} pending={followPending} onClick={onToggleFollow} />
          {onHide && (
            <ChannelPill tone="danger" onClick={onHide}>
              Hide<span className="sr-only"> {video.channelName} from Outliers</span>
            </ChannelPill>
          )}
        </>
      }
      hoverActions={
        <>
          {onFindSimilar && (
            <ThumbAction label="Find similar videos" onClick={onFindSimilar}>
              <Layers className="size-4" />
            </ThumbAction>
          )}
          <ThumbAction label="View on YouTube" href={youtube}>
            <ExternalLink className="size-4" />
          </ThumbAction>
        </>
      }
      menu={menu}
      footer={footer}
    />
  );
}
