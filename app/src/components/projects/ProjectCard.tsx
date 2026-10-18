"use client";

import { useState } from "react";
import Link from "next/link";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { MenuItem, Popover } from "@/components/ui/Popover";
import { ChannelAvatar } from "@/components/settings/ChannelSelect";
import { cn, timeAgo } from "@/lib/format";
import type { ProjectStatus } from "@/lib/projects/status";
import type { ProjectSummary } from "@/lib/projects/types";
import { ProjectStatusMenu } from "./ProjectStatusMenu";

// Whole card links to the project; the menu and status chip sit above the link layer.
export function ProjectCard({
  project,
  onEdit,
  onDelete,
  onStatusChange,
  statusBusy,
}: {
  project: ProjectSummary;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (status: ProjectStatus) => void;
  statusBusy: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const label = project.primaryChannelName ?? project.name;
  return (
    <article
      className={cn(
        "group relative rounded-xl border border-stroke bg-white transition hover:border-primary/40 hover:shadow-sm dark:border-white/10 dark:bg-[#18191c] dark:hover:border-sky-400/40",
        (menuOpen || statusOpen) && "z-30",
      )}
    >
      <Link
        href={`/projects/${project.id}`}
        aria-label={`Open project ${project.name}`}
        className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      />
      <div className="absolute right-3 top-3 z-30">
        <Popover
          align="right"
          panelClassName="w-48 min-w-0"
          onOpenChange={setMenuOpen}
          trigger={({ toggle, open }) => (
            <button
              type="button"
              onClick={toggle}
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label={`Project actions for ${project.name}`}
              title={`Project actions for ${project.name}`}
              className="flex size-10 items-center justify-center rounded-lg text-dark-5 transition hover:bg-gray-100 hover:text-dark dark:hover:bg-white/10 dark:hover:text-white"
            >
              <MoreHorizontal className="size-4" />
            </button>
          )}
        >
          {(close) => (
            <div role="menu">
              <MenuItem
                icon={<Pencil className="size-4" />}
                onClick={() => {
                  close();
                  onEdit();
                }}
              >
                Edit details
              </MenuItem>
              <MenuItem
                danger
                icon={<Trash2 className="size-4" />}
                onClick={() => {
                  close();
                  onDelete();
                }}
              >
                Delete project
              </MenuItem>
            </div>
          )}
        </Popover>
      </div>
      <div className="pointer-events-none relative z-20 p-5">
        <div className="flex min-h-[160px] flex-col">
          <div className="flex min-w-0 items-center gap-3 pr-12">
            <ChannelAvatar name={label} avatar={project.primaryChannelAvatar} size={48} />
            <h2 className="truncate text-lg font-semibold text-dark dark:text-white">{project.name}</h2>
          </div>
          <p className="mt-4 line-clamp-2 text-sm text-dark-5">{project.description?.trim() || "Shared workspace"}</p>
          <div className="mt-auto flex items-center justify-between gap-3 pt-4">
            <div className="pointer-events-auto">
              <ProjectStatusMenu
                status={project.status}
                onChange={onStatusChange}
                disabled={statusBusy}
                compact
                showChevron={false}
                onOpenChange={setStatusOpen}
              />
            </div>
            <p className="min-w-0 truncate text-right text-xs text-dark-5" suppressHydrationWarning>
              {project.itemCount} {project.itemCount === 1 ? "item" : "items"} · Updated {timeAgo(project.updatedAt)}
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}
