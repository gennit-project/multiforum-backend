import type {Comment,DiscussionChannel,ScratchpadEntry,User} from '../../src/generated/graphql.js';
import type {Projection,Selection} from './selection.js';

export const scratchpadUsernameSelection={username:true} as const satisfies Selection<User>;
export const scratchpadRecipientSelection={username:true,displayName:true} as const satisfies Selection<User>;
export const scratchpadCommentCoreSelection={
 id:true,UpvotedByUsers:scratchpadUsernameSelection,SuperUpvotedByUsers:scratchpadUsernameSelection,
 DiscussionChannel:{discussionId:true,channelUniqueName:true},
} as const satisfies Selection<Comment>;
// Only the User branch is requested. Other union members select no fields;
// the existing moderator resolution error is preserved, not repaired here.
export const scratchpadCommentSelection={...scratchpadCommentCoreSelection,
 CommentAuthor:{'... on User':scratchpadUsernameSelection},
} as const;
export const scratchpadDiscussionSelection={
 id:true,discussionId:true,channelUniqueName:true,
 UpvotedByUsers:scratchpadUsernameSelection,SuperUpvotedByUsers:scratchpadUsernameSelection,
 Discussion:{Author:scratchpadUsernameSelection},
} as const satisfies Selection<DiscussionChannel>;
export const scratchpadOwnershipSelection={id:true,Recipient:scratchpadUsernameSelection} as const satisfies Selection<ScratchpadEntry>;
export const scratchpadEntrySelection={id:true,text:true,isPublic:true,sourceType:true,sourceId:true,
 sourceChannelUniqueName:true,discussionId:true,createdAt:true,
} as const satisfies Selection<ScratchpadEntry>;
export const scratchpadVisibilitySelection={...scratchpadEntrySelection,Recipient:scratchpadUsernameSelection,
 Author:{username:true,displayName:true,profilePicURL:true},
} as const satisfies Selection<ScratchpadEntry>;

export type ScratchpadRecipient=Projection<User,typeof scratchpadRecipientSelection>;
type CommentUser=Extract<NonNullable<Comment['CommentAuthor']>,{__typename?:'User'}>;
export type ScratchpadCommentSource=Projection<Comment,typeof scratchpadCommentCoreSelection> & {
 CommentAuthor:Projection<CommentUser,typeof scratchpadUsernameSelection>|Record<string,never>|null;
};
export type ScratchpadDiscussionSource=Projection<DiscussionChannel,typeof scratchpadDiscussionSelection>;
export type ScratchpadOwnership=Projection<ScratchpadEntry,typeof scratchpadOwnershipSelection>;
export type ScratchpadVisibility=Projection<ScratchpadEntry,typeof scratchpadVisibilitySelection>;
export type ScratchpadEntryProjection=Projection<ScratchpadEntry,typeof scratchpadEntrySelection>;
