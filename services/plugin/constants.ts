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
