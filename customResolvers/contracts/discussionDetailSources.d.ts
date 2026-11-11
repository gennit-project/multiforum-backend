import type {Integer} from 'neo4j-driver';
import type {CustomChannelAnswer,RawCountConnection} from './customCommentSources.js';
import type {DiscussionListFlair} from './discussionListFlairs.js';
/** Exact fixed database maps, not complete generated entities. */
export type DetailIdentity={username:unknown;displayName:unknown};
export type DetailPreviewImage={id:unknown;url:unknown;alt:unknown;caption:unknown;copyright:unknown;Uploader:DetailIdentity|null};
export type DetailImage=DetailPreviewImage & {createdAt:unknown};
export type DetailFile={
 id:unknown;createdAt:unknown;fileName:unknown;url:unknown;kind:unknown;size:unknown;
 priceModel:unknown;priceCents:unknown;priceCurrency:unknown;downloadCountTotal:unknown;downloadCountUnique:unknown;
 attributionOverride:unknown;supportPatreonUrl:unknown;supportBuyMeACoffeeUrl:unknown;supportKoFiUrl:unknown;supportPayPalMeUrl:unknown;
 scanStatus:unknown;scanCheckedAt:unknown;scanReason:unknown;uploadedByUsername:unknown;license:{id:unknown;name:unknown}|null;
};
export type DetailCore={
 id:string;title:unknown;body:unknown;createdAt:unknown;updatedAt:unknown;hasDownload:unknown;hasSensitiveContent:unknown;
 Author:(DetailIdentity & {profilePicURL:unknown;createdAt:unknown;discussionKarma:unknown;commentKarma:unknown})|null;
 Album:{id:unknown;imageOrder:unknown;Images:DetailImage[];_detailImagesHasNextPage:boolean}|null;
 Tags:{text:unknown}[];FeedbackCommentsAggregate:{count:Integer};FeedbackCommentsConnection:RawCountConnection;
 FeedbackComments:{id:unknown}[];isFavorited:boolean|null;
 CrosspostedDiscussion:{id:unknown;title:unknown;body:unknown;createdAt:unknown;
  Author:(DetailIdentity & {profilePicURL:unknown})|null;
  Album:{id:unknown;imageOrder:unknown;Images:DetailPreviewImage[]}|null;
  DiscussionChannels:{channelUniqueName:unknown;Channel:{uniqueName:unknown;displayName:unknown}|null}[];
 }|null;
 SharedCollection:{id:unknown;name:unknown;description:unknown;collectionType:unknown;visibility:unknown;itemCount:Integer;
  CreatedBy:(DetailIdentity & {profilePicURL:unknown})|null;
 }|null;
};
export type DetailChannel={
 id:unknown;discussionId:string;channelUniqueName:string;weightedVotesCount:unknown;archived:unknown;answered:unknown;locked:unknown;emoji:unknown;
 Flairs:DiscussionListFlair[];UpvotedByUsers:{username:string}[];SuperUpvotedByUsers:{username:string}[];
 UpvotedByUsersAggregate:{count:Integer};UpvotedByUsersConnection:RawCountConnection;
 CommentsAggregate:{count:Integer};CommentsConnection:RawCountConnection;
 Answers:CustomChannelAnswer[];_detailAnswersHasNextPage:boolean;
 LabelOptions:{id:unknown;value:unknown;displayName:unknown;order:unknown;group:{id:unknown;key:unknown;displayName:unknown}|null}[];
 Discussion:{id:string};Channel:{uniqueName:string;channelIconURL:unknown;displayName:unknown;feedbackEnabled:unknown;imageUploadsEnabled:unknown;markdownImagesEnabled:unknown;emojiEnabled:unknown};
};
export type DetailSource=DetailCore & {DiscussionChannels:DetailChannel[];DownloadableFiles:DetailFile[];_detailFilesHasNextPage:boolean};
/** Public-schema keys checked at the actual root registration. Private cursor
 * and author discriminators remain source-only. Union completion has its own
 * checked resolver; no fabricated public discriminator is added here. */
type IdentitySelection={username:true;displayName:true};
type CountSelection={totalCount:true;aggregate:{count:{nodes:true}}};
type ImageSelection={id:true;url:true;alt:true;caption:true;copyright:true;Uploader:IdentitySelection};
export type DetailFileSelection={id:true;createdAt:true;fileName:true;url:true;kind:true;size:true;priceModel:true;priceCents:true;priceCurrency:true;downloadCountTotal:true;downloadCountUnique:true;attributionOverride:true;supportPatreonUrl:true;supportBuyMeACoffeeUrl:true;supportKoFiUrl:true;supportPayPalMeUrl:true;scanStatus:true;scanCheckedAt:true;scanReason:true;uploadedByUsername:true;license:{id:true;name:true}};
export type DetailImageSelection=ImageSelection & {createdAt:true};
export type DetailAnswerSelection={id:true;text:true;createdAt:true};
export type DetailSourceSelection={
 id:true;title:true;body:true;createdAt:true;updatedAt:true;hasDownload:true;hasSensitiveContent:true;isFavorited:true;
 Author:IdentitySelection & {profilePicURL:true;createdAt:true;discussionKarma:true;commentKarma:true};
 Album:{id:true;imageOrder:true;Images:DetailImageSelection};Tags:{text:true};FeedbackComments:{id:true};FeedbackCommentsConnection:CountSelection;
 CrosspostedDiscussion:{id:true;title:true;body:true;createdAt:true;Author:IdentitySelection & {profilePicURL:true};
  Album:{id:true;imageOrder:true;Images:ImageSelection};DiscussionChannels:{channelUniqueName:true;Channel:{uniqueName:true;displayName:true}}};
 SharedCollection:{id:true;name:true;description:true;collectionType:true;visibility:true;itemCount:true;CreatedBy:IdentitySelection & {profilePicURL:true}};
 DiscussionChannels:{id:true;discussionId:true;channelUniqueName:true;weightedVotesCount:true;archived:true;answered:true;locked:true;emoji:true;
  Flairs:{id:true;channelUniqueName:true;displayName:true;color:true;order:true;archived:true};UpvotedByUsers:{username:true};SuperUpvotedByUsers:{username:true};
  UpvotedByUsersConnection:CountSelection;CommentsConnection:CountSelection;Answers:DetailAnswerSelection;
  LabelOptions:{id:true;value:true;displayName:true;order:true;group:{id:true;key:true;displayName:true}};
  Discussion:{id:true};Channel:{uniqueName:true;channelIconURL:true;displayName:true;feedbackEnabled:true;imageUploadsEnabled:true;markdownImagesEnabled:true;emojiEnabled:true}};
 DownloadableFiles:DetailFileSelection;
};
