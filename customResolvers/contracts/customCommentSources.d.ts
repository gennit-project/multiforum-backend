import type {Integer} from 'neo4j-driver';
import type {AuthorSourceType} from '../../services/authorSourceType.js';
/** Type provenance is computed from the fixed query's explicit node labels. */
export type CustomCommentAuthorIdentity={username:unknown;displayName:unknown;__sourceAuthorType:AuthorSourceType|null};
export type CustomCommentAuthor=CustomCommentAuthorIdentity & {
 profilePicURL:unknown;discussionKarma:unknown;commentKarma:unknown;createdAt:unknown;isBot:unknown;
};
export type RawUsername={username:unknown};
export type RawCountConnection={totalCount:Integer;aggregate:{count:{nodes:Integer}}};
export type CustomTextVersion={id:unknown;body:unknown;editReason:unknown;createdAt:unknown;Author:RawUsername|null};
export type CustomViewerComment={
 id:unknown;text:unknown;emoji:unknown;weightedVotesCount:unknown;createdAt:unknown;updatedAt:unknown;
 textLastEdited:unknown;archived:unknown;isSticky:unknown;stickyAt:unknown;stickyByUsername:unknown;
 CommentAuthor:CustomCommentAuthor|null;isFavoritedByUser:boolean;
 UpvotedByUsers:RawUsername[];UpvotedByUsersAggregate:{count:Integer};UpvotedByUsersConnection:RawCountConnection;
 SuperUpvotedByUsers:RawUsername[];ChildCommentsAggregate:{count:Integer};ChildCommentsConnection:RawCountConnection;
 PastVersions:CustomTextVersion[];SubscribedToNotifications:{username:string}[];
};
export type CustomRootComment=CustomViewerComment & {ParentComment:null;FeedbackComments:{id:unknown}[]};
export type CustomReplyComment=CustomViewerComment & {
 ParentComment:{id:string};FeedbackComments:{id:unknown}[];
 Event:{id:unknown}|null;DiscussionChannel:{id:unknown;channelUniqueName:unknown;discussionId:unknown}|null;
};
export type CustomEventComment=CustomViewerComment & {
 ParentComment:null;ChildComments:{id:unknown;text:unknown}[];Event:{id:string};DiscussionChannel:null;
};
export type CustomChannelAnswer={id:unknown;text:unknown;createdAt:unknown;CommentAuthor:CustomCommentAuthorIdentity|null};
export type CustomCommentSectionChannel={
 id:unknown;weightedVotesCount:unknown;discussionId:string;channelUniqueName:string;emoji:unknown;
 archived:unknown;locked:unknown;answered:unknown;
 UpvotedByUsers:RawUsername[];UpvotedByUsersAggregate:{count:Integer};UpvotedByUsersConnection:RawCountConnection;
 SuperUpvotedByUsers:RawUsername[];CommentsAggregate:{count:Integer};CommentsConnection:RawCountConnection;
 RootCommentsAggregate:{count:Integer};RootCommentsConnection:RawCountConnection;
 SubscribedToNotifications:{username:string}[];Answers:CustomChannelAnswer[];_detailAnswersHasNextPage:boolean;
 Channel:{uniqueName:string;feedbackEnabled:unknown;imageUploadsEnabled:unknown;markdownImagesEnabled:unknown;emojiEnabled:unknown;
  Bots:{username:unknown;displayName:unknown;botProfileId:unknown;isDeprecated:unknown}[];Moderators:{displayName:unknown}[]};
 Discussion:{id:string;title:unknown;Author:{username:unknown;displayName:unknown;profilePicURL:unknown;commentKarma:unknown;createdAt:unknown;discussionKarma:unknown}|null};
};
