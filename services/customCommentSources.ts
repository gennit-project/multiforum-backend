import type {CustomCommentAuthorIdentity,CustomViewerComment,CustomRootComment,CustomReplyComment,CustomEventComment,CustomCommentSectionChannel,RawCountConnection} from '../customResolvers/contracts/customCommentSources.js';
import {rememberCanonicalSource as remember} from './canonicalSourceFields.js';
import {rememberAuthorSourceType} from './authorSourceType.js';
function author(source:CustomCommentAuthorIdentity|null){
 if(!source)return;
 remember(source);
 rememberAuthorSourceType(source,source.__sourceAuthorType);
 // Keep database-only provenance out of ordinary object/JSON enumeration too.
 Object.defineProperty(source,'__sourceAuthorType',{enumerable:false});
}
function connection(source:RawCountConnection){remember(source);remember(source.aggregate);remember(source.aggregate.count);}
function comment<T extends CustomViewerComment>(source:T):T {
 remember(source);author(source.CommentAuthor);
 source.UpvotedByUsers.forEach(remember);source.SuperUpvotedByUsers.forEach(remember);
 source.SubscribedToNotifications.forEach(remember);
 remember(source.UpvotedByUsersAggregate);connection(source.UpvotedByUsersConnection);
 remember(source.ChildCommentsAggregate);connection(source.ChildCommentsConnection);
 for(const version of source.PastVersions){remember(version);if(version.Author)remember(version.Author);}
 return source;
}
export function canonicalRootComment(source:CustomRootComment):CustomRootComment {
 comment(source);source.FeedbackComments.forEach(remember);return source;
}
export function canonicalReplyComment(source:CustomReplyComment):CustomReplyComment {
 comment(source);remember(source.ParentComment);source.FeedbackComments.forEach(remember);
 if(source.Event)remember(source.Event);if(source.DiscussionChannel)remember(source.DiscussionChannel);
 return source;
}
export function canonicalEventComment(source:CustomEventComment):CustomEventComment {
 comment(source);source.ChildComments.forEach(remember);remember(source.Event);return source;
}
export function canonicalCommentSectionChannel(source:CustomCommentSectionChannel):CustomCommentSectionChannel {
 remember(source);source.UpvotedByUsers.forEach(remember);source.SuperUpvotedByUsers.forEach(remember);
 source.SubscribedToNotifications.forEach(remember);
 remember(source.UpvotedByUsersAggregate);connection(source.UpvotedByUsersConnection);
 remember(source.CommentsAggregate);connection(source.CommentsConnection);
 for(const answer of source.Answers){remember(answer);author(answer.CommentAuthor);}
 remember(source.Channel);source.Channel.Bots.forEach(remember);source.Channel.Moderators.forEach(remember);
 remember(source.Discussion);if(source.Discussion.Author)remember(source.Discussion.Author);
 return source;
}
