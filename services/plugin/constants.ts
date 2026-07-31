export const PLUGIN_EVENTS = {
  DOWNLOADABLE_FILE_CREATED: "downloadableFile.created",
  DOWNLOADABLE_FILE_UPDATED: "downloadableFile.updated",
  DOWNLOADABLE_FILE_DOWNLOADED: "downloadableFile.downloaded",
  COMMENT_CREATED: "comment.created",
  DISCUSSION_CHANNEL_CREATED: "discussionChannel.created",
} as const;

export type PluginEvent = (typeof PLUGIN_EVENTS)[keyof typeof PLUGIN_EVENTS];

// Server-scoped download events
export const DOWNLOAD_EVENTS: ReadonlySet<string> = new Set([
  PLUGIN_EVENTS.DOWNLOADABLE_FILE_CREATED,
  PLUGIN_EVENTS.DOWNLOADABLE_FILE_UPDATED,
  PLUGIN_EVENTS.DOWNLOADABLE_FILE_DOWNLOADED,
]);

// Comment events
export const COMMENT_EVENTS: ReadonlySet<string> = new Set([
  PLUGIN_EVENTS.COMMENT_CREATED,
]);

// Channel-scoped events
export const CHANNEL_EVENTS: ReadonlySet<string> = new Set([
  PLUGIN_EVENTS.DISCUSSION_CHANNEL_CREATED,
]);

export const CURRENT_SERVER_VERSION = "1.0.0";
export const SUPPORTED_PLUGIN_API_VERSION = "1";
