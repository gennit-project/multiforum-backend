import type { MutationResolvers, Comment, DiscussionChannel } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { Selection, SelectedResolver } from "./selection.js";

// JSON's internal shape is outside the generated scalar type boundary.
export const reactionResponseSelection = { id: true, emoji: true } as const satisfies Selection<Comment> & Selection<DiscussionChannel>;
export const reactionMutationNames = [
  "addEmojiToComment", "removeEmojiFromComment",
  "addEmojiToDiscussionChannel", "removeEmojiFromDiscussionChannel",
] as const;
export type ReactionMutationName = typeof reactionMutationNames[number];
export type ReactionMutationResolvers = {
  addEmojiToComment: SelectedResolver<MutationResolvers<GraphQLContext>["addEmojiToComment"], typeof reactionResponseSelection>;
  removeEmojiFromComment: SelectedResolver<MutationResolvers<GraphQLContext>["removeEmojiFromComment"], typeof reactionResponseSelection>;
  addEmojiToDiscussionChannel: SelectedResolver<MutationResolvers<GraphQLContext>["addEmojiToDiscussionChannel"], typeof reactionResponseSelection>;
  removeEmojiFromDiscussionChannel: SelectedResolver<MutationResolvers<GraphQLContext>["removeEmojiFromDiscussionChannel"], typeof reactionResponseSelection>;
};
