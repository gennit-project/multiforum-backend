import type { ModerationUndoMutationResolvers } from "../../customResolvers/contracts/moderationUndo.js";
import type { SuperVoteCommentSnapshot, SuperVoteDiscussionSnapshot } from "../../services/persistence/superVoteUndoRepository.js";
import undo from "../../customResolvers/mutations/undoSuperUpvote.js";
declare const resolver:ReturnType<typeof undo>;
const checked:ModerationUndoMutationResolvers={undoSuperUpvote:resolver};
declare const comment:SuperVoteCommentSnapshot,discussion:SuperVoteDiscussionSnapshot;
// @ts-expect-error the preliminary projection does not fetch a full Comment
const text:string=comment.text;
// @ts-expect-error the preliminary projection does not fetch full discussion fields
const title:string=discussion.Discussion?.title;
// @ts-expect-error response readiness follows generated Boolean
const invalidSuccess:ModerationUndoMutationResolvers["undoSuperUpvote"]=async()=>({success:"true",message:"ok",sourceId:"c",sourceType:"comment"});
// @ts-expect-error raw post-write usernames remain unknown, not certified User data
const users=(result:Awaited<ReturnType<typeof resolver>>):Array<{username:string}>=>result.superUpvotedByUsers;
void [checked,text,title,invalidSuccess,users];

const moderator: SuperVoteCommentSnapshot["CommentAuthor"] = {displayName:"Moderator"};
// @ts-expect-error both author branches now select a discriminator field
const missingAuthor: SuperVoteCommentSnapshot["CommentAuthor"] = {};
// @ts-expect-error the source does not expose a moderator's backing User
void moderator.User;
void [moderator, missingAuthor];
