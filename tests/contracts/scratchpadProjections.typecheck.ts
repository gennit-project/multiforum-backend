import type {ScratchpadCommentSource,ScratchpadDiscussionSource,ScratchpadRecipient,ScratchpadVisibility} from '../../customResolvers/contracts/scratchpadProjections.js';
declare const comment:ScratchpadCommentSource;
declare const discussion:ScratchpadDiscussionSource;
declare const entry:ScratchpadVisibility;
const voters:{username:string}[]=comment.UpvotedByUsers;
const discussionVoters:{username:string}[]=discussion.SuperUpvotedByUsers;
const owner:string|undefined=entry.Recipient?.username;
// @ts-expect-error selected nullable displayName must be present, not silently optional
const incomplete:ScratchpadRecipient={username:'alice'};
// @ts-expect-error query did not select user email
void comment.UpvotedByUsers[0].Email;
// @ts-expect-error discussion projection is not a full Discussion
void discussion.Discussion?.body;
// @ts-expect-error visibility query does not select the computed vote cache
void entry.superUpvotedByUsers;
const absentAuthor:ScratchpadCommentSource['CommentAuthor']=null;
const otherBranch:ScratchpadCommentSource['CommentAuthor']={};
const userAuthor:ScratchpadCommentSource['CommentAuthor']={username:'alice'};
void [voters,discussionVoters,owner,incomplete,absentAuthor,otherBranch,userAuthor];
