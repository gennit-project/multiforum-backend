import type {ForumMembershipChannel} from '../../customResolvers/contracts/forumMembershipSource.js';
export function forumMembershipChannel(uniqueName='cats'):ForumMembershipChannel {
 return {
  uniqueName,displayName:null,description:null,locked:null,lockReason:null,deleted:null,
  channelIconURL:null,icon32Url:null,icon48Url:null,icon64Url:null,icon96Url:null,channelBannerURL:null,
  eventsEnabled:null,wikiEnabled:null,feedbackEnabled:null,downloadsEnabled:null,emojiEnabled:null,
  imageUploadsEnabled:null,markdownImagesEnabled:null,allowPaidDownloads:null,allowPaywalledPosts:null,
  requireVerifiedPhoneForUploads:null,requireVerifiedEmailToPost:null,markAsAnsweredEnabled:null,
  discussionFlairRequired:null,allowedFileTypes:null,payoutPercent:null,variantUrls:null,rules:null,
  pluginPipelines:null,createdAt:'2020-01-01T00:00:00.000Z',lockedAt:null,
 };
}
