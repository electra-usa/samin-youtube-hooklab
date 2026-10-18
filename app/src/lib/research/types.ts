// Client-side shape of a research video: the original /api/outliers/videos item
// (same fields as OutlierVideo in lib/db/library) plus where Following found it.
export type ResearchVideo = {
  id: string;
  videoId: string;
  title: string;
  titleLength: number | null;
  videoUrl: string;
  thumbnail: string;
  channelId: string | null;
  channelName: string | null;
  subscriberCount: number | null;
  views: number | null;
  outlierScore: number | null;
  publishAt: string | null;
  duration: string | null;
  durationSeconds: number | null;
  isShort: boolean;
  frame: string | null;
  secondaryFrame: string | null;
  pov: string | null;
  featuredInNewsletter: boolean;
  niches: string[];
  clickTriggers: string[];
  videoTypes: string[];
  isBookmarked: boolean;
  bookmarkTags: string[];
  projectIds: string[];
  source?: "library" | "feed";
};

export type FollowingListSummary = { id: string; name: string; channelIds: string[] };

export type HiddenChannel = { channelId: string; channelName: string };
