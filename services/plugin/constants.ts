// Server-scoped download events
export const DOWNLOAD_EVENTS = new Set([
  'downloadableFile.created',
  'downloadableFile.updated',
  'downloadableFile.downloaded'
])

// Comment events
export const COMMENT_EVENTS = new Set([
  'comment.created'
])

// Channel-scoped events
export const CHANNEL_EVENTS = new Set([
  'discussionChannel.created',
])

export const CURRENT_SERVER_VERSION = '1.0.0'
export const SUPPORTED_PLUGIN_API_VERSION = '1'
