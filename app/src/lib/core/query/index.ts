// Query core over the video library, shared by the `hooklab` CLI (plain Node) and /api/v1 (Next).
// Framework-free: relative imports with .ts extensions, no "server-only", no "@/" aliases.
export { QueryError, isQueryError } from "./errors.ts";
export {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  SEARCH_MODES,
  SHORTS_FILTERS,
  VIDEO_FIELDS,
  VIDEO_QUERY_PARAMS,
  VIDEO_SORTS,
  countVideos,
  getVideo,
  parseVideoRef,
  searchVideos,
  type SearchMode,
  type ShortsFilter,
  type VideoField,
  type VideoPage,
  type VideoRecord,
  type VideoSearchInput,
  type VideoSort,
} from "./videos.ts";
export {
  CHANNEL_QUERY_PARAMS,
  CHANNEL_SORTS,
  getChannel,
  listChannels,
  type ChannelBreakdown,
  type ChannelDetail,
  type ChannelListInput,
  type ChannelPage,
  type ChannelRecord,
  type ChannelSort,
} from "./channels.ts";
export { parseChannelRef } from "./channel-index.ts";
export { libraryCounts, libraryStats, type LibraryStats, type RefreshSummary } from "./stats.ts";
export { CLICK_TRIGGERS, NICHES, TIERS, TITLE_FORMATS, taxonomy, tierForScore, type Taxonomy, type TierInfo, type TitleFormatInfo } from "./taxonomy.ts";
export { EXPORT_FORMATS, exportColumns, exportStream, exportVideos, type ExportFormat, type ExportOptions } from "./export.ts";
export { csvCell, csvLine, csvRows } from "./csv.ts";
export type { ParamValue } from "./values.ts";
