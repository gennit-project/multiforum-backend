import type {NotificationComment,NotificationMentionComment,NotificationIssueSubscribers,SubscriberSnapshot} from '../../customResolvers/contracts/notificationProjections.js';
import type {Comment} from '../../src/generated/graphql.js';
declare const comment:NotificationComment;
// @ts-expect-error nested projections do not provide complete entities
const full:Comment=comment;
if(comment.CommentAuthor?.__typename==='User'){
 const username:string=comment.CommentAuthor.username;
 // @ts-expect-error user author does not fetch email in this projection
 void comment.CommentAuthor.Email;
 void username;
}
if(comment.CommentAuthor?.__typename==='ModerationProfile'){
 // @ts-expect-error profile owner relationship remains nullable
 void comment.CommentAuthor.User.username;
}
declare const mention:NotificationMentionComment;
// @ts-expect-error mention query does not select a discriminator
void mention.CommentAuthor?.__typename;
// @ts-expect-error selected nullable email relationship must be present
const subscriber:SubscriberSnapshot={username:'reader'};
declare const issue:NotificationIssueSubscribers;
// @ts-expect-error issue subscribers do not select unrelated user preferences
void issue.SubscribedToNotifications[0].notifyWhenTagged;
// @ts-expect-error parent reply selection does not fetch parent discussion relationship
void comment.ParentComment?.DiscussionChannel;
void [full,subscriber];

import {createCommentReplyNotificationEmail} from '../../customResolvers/mutations/shared/emailUtils.js';
// @ts-expect-error known consumer exception: schema-nullable text is not accepted by the renderer
createCommentReplyNotificationEmail(comment.text,'title','author','url');
