import type { CardVideo } from "@/components/video/VideoCard";
import type { ProjectStatus } from "./status";

export const PROJECT_ITEM_KINDS = ["chat", "bookmark", "video", "title", "studio", "note"] as const;
export type ProjectItemKind = (typeof PROJECT_ITEM_KINDS)[number];

/** List row returned by GET /api/projects (superset of AddToProjectModal's ProjectSummary). */
export type ProjectSummary = {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  primaryChannelId: string | null;
  primaryChannelName: string | null;
  primaryChannelAvatar: string | null;
};

export type ProjectItem = {
  id: string;
  projectId: string;
  kind: ProjectItemKind;
  refId: string | null;
  payload: unknown;
  createdAt: string;
};

// Detail entries carry an `entryId` used by DELETE /api/projects/[id]/items/[entryId]:
// a project_items id, or "chat:<id>" / "pin:<id>" / "studio:<id>" for links that live on
// the chats, pinned_titles and studio_workspaces rows themselves.
export type ProjectChatEntry = { entryId: string; id: string; title: string; updatedAt: string; messageCount: number };
export type ProjectTitleEntry = {
  entryId: string;
  title: string;
  thumbnailText: string | null;
  chatId: string | null;
  source: "saved" | "pinned";
  createdAt: string;
};
export type ProjectVideoEntry = { entryId: string; kind: "video" | "bookmark"; video: CardVideo; createdAt: string };
export type ProjectStudioEntry = { entryId: string; workspaceId: string; name: string; updatedAt: string | null };
export type ProjectNoteEntry = { entryId: string; text: string; createdAt: string; updatedAt: string | null };

export type ProjectDetail = {
  project: ProjectSummary;
  chats: ProjectChatEntry[];
  titles: ProjectTitleEntry[];
  videos: ProjectVideoEntry[];
  studio: ProjectStudioEntry[];
  notes: ProjectNoteEntry[];
};
