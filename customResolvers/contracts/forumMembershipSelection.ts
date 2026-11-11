import type {Channel} from '../../src/generated/graphql.js';
import type {Selection} from './selection.js';

/** Exact fixed post-write selection; do not shrink it to the fields callers use.
 * GraphQL projection failures currently follow committed relationship writes.
 */
export const forumMembershipSelection={
 uniqueName:true,displayName:true,description:true,locked:true,lockReason:true,deleted:true,
 channelIconURL:true,icon32Url:true,icon48Url:true,icon64Url:true,icon96Url:true,channelBannerURL:true,
 eventsEnabled:true,wikiEnabled:true,feedbackEnabled:true,downloadsEnabled:true,emojiEnabled:true,
 imageUploadsEnabled:true,markdownImagesEnabled:true,allowPaidDownloads:true,allowPaywalledPosts:true,
 requireVerifiedPhoneForUploads:true,requireVerifiedEmailToPost:true,markAsAnsweredEnabled:true,
 discussionFlairRequired:true,allowedFileTypes:true,payoutPercent:true,variantUrls:true,rules:true,
 pluginPipelines:true,createdAt:true,lockedAt:true,
} as const satisfies Selection<Channel>;
