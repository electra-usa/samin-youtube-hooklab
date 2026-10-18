"use client";

import { useState } from "react";
import { AddToProjectModal } from "@/components/projects/AddToProjectModal";
import { toast } from "@/components/ui/Toaster";
import { AddTagsModal, ManageBookmarkModal } from "@/components/bookmarks/TagModals";
import { sendJson } from "@/lib/api-client";
import { BOOKMARKS_UPDATED, emit } from "@/lib/client-events";
import type { ResearchVideo } from "@/lib/research/types";
import { actionToast } from "./ActionToast";

type Patch = Partial<Pick<ResearchVideo, "isBookmarked" | "bookmarkTags" | "projectIds">>;

/**
 * Bookmark / tag / project actions shared by every research grid. The caller keeps
 * the video list; `onPatch` applies the change locally. Render `modals` once.
 */
export function useVideoActions({ onPatch, onBookmarkRemoved }: { onPatch: (videoId: string, patch: Patch) => void; onBookmarkRemoved?: (videoId: string) => void }) {
  const [tagTarget, setTagTarget] = useState<ResearchVideo | null>(null);
  const [manageTarget, setManageTarget] = useState<ResearchVideo | null>(null);
  const [projectTarget, setProjectTarget] = useState<ResearchVideo | null>(null);

  const addTags = async (video: ResearchVideo, tags: string[]) => {
    try {
      const res = await sendJson<{ tags: string[] }>(`/api/bookmarks/${video.videoId}/tags`, "POST", { tags });
      onPatch(video.videoId, { bookmarkTags: res.tags });
      setManageTarget((m) => (m?.videoId === video.videoId ? { ...m, bookmarkTags: res.tags } : m));
      emit(BOOKMARKS_UPDATED);
      toast.success(tags.length === 1 ? `Tag "${tags[0]}" added` : `${tags.length} tags added`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add tag");
    }
  };

  const removeTag = async (video: ResearchVideo, tag: string) => {
    try {
      const res = await sendJson<{ tags: string[] }>(`/api/bookmarks/${video.videoId}/tags?tag=${encodeURIComponent(tag)}`, "DELETE");
      onPatch(video.videoId, { bookmarkTags: res.tags });
      setManageTarget((m) => (m?.videoId === video.videoId ? { ...m, bookmarkTags: res.tags } : m));
      emit(BOOKMARKS_UPDATED);
      toast.success(`Tag "${tag}" removed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove tag");
    }
  };

  const bookmark = async (video: ResearchVideo, opts: { promptTags?: boolean } = {}) => {
    try {
      await sendJson("/api/bookmarks", "POST", { video });
      onPatch(video.videoId, { isBookmarked: true, bookmarkTags: [] });
      emit(BOOKMARKS_UPDATED);
      if (opts.promptTags === false) toast.success("Video bookmarked");
      else actionToast("Video bookmarked", "Add tag", () => setTagTarget({ ...video, isBookmarked: true, bookmarkTags: [] }));
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't bookmark video");
      return false;
    }
  };

  const removeBookmark = async (video: ResearchVideo) => {
    try {
      await sendJson(`/api/bookmarks/${video.videoId}`, "DELETE");
      onPatch(video.videoId, { isBookmarked: false, bookmarkTags: [] });
      setManageTarget(null);
      onBookmarkRemoved?.(video.videoId);
      emit(BOOKMARKS_UPDATED);
      toast.success("Bookmark removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove bookmark");
    }
  };

  const copyTitle = async (video: ResearchVideo) => {
    try {
      await navigator.clipboard.writeText(video.title);
      toast.success("Title copied");
    } catch {
      toast.error("Couldn't copy. Try again.");
    }
  };

  const modals = (
    <>
      <AddTagsModal
        open={!!tagTarget}
        onClose={() => setTagTarget(null)}
        existingTags={tagTarget?.bookmarkTags ?? []}
        onAddTags={(tags) => tagTarget && void addTags(tagTarget, tags)}
      />
      <ManageBookmarkModal
        open={!!manageTarget}
        onClose={() => setManageTarget(null)}
        videoTitle={manageTarget?.title ?? ""}
        tags={manageTarget?.bookmarkTags ?? []}
        onAddTag={(tag) => manageTarget && void addTags(manageTarget, [tag])}
        onRemoveTag={(tag) => manageTarget && void removeTag(manageTarget, tag)}
        onRemoveBookmark={() => manageTarget && void removeBookmark(manageTarget)}
      />
      {projectTarget && (
        <AddToProjectModal
          open
          onClose={() => setProjectTarget(null)}
          item={{ kind: "video", refId: projectTarget.videoId, payload: projectTarget, label: projectTarget.title }}
          onAdded={(projectId) =>
            onPatch(projectTarget.videoId, { projectIds: [...new Set([...(projectTarget.projectIds ?? []), projectId])] })
          }
        />
      )}
    </>
  );

  return {
    bookmark,
    removeBookmark,
    copyTitle,
    addTags,
    openTagPicker: (video: ResearchVideo) => setTagTarget(video),
    manageBookmark: (video: ResearchVideo) => setManageTarget(video),
    addToProject: (video: ResearchVideo) => setProjectTarget(video),
    modals,
  };
}

export type VideoActions = ReturnType<typeof useVideoActions>;
