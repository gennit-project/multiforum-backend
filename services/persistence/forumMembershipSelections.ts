// Keep default mutation response fields: projection errors can follow committed writes.
// Live parity tests check this selection against the installed OGM default.
export const CHANNEL_MEMBERSHIP_SELECTION = `{
  uniqueName
  displayName
  description
  locked
  lockReason
  deleted
  channelIconURL
  icon32Url
  icon48Url
  icon64Url
  icon96Url
  channelBannerURL
  eventsEnabled
  wikiEnabled
  feedbackEnabled
  downloadsEnabled
  emojiEnabled
  imageUploadsEnabled
  markdownImagesEnabled
  allowPaidDownloads
  allowPaywalledPosts
  requireVerifiedPhoneForUploads
  requireVerifiedEmailToPost
  markAsAnsweredEnabled
  discussionFlairRequired
  allowedFileTypes
  payoutPercent
  variantUrls
  rules
  pluginPipelines
  createdAt
  lockedAt
}`;
