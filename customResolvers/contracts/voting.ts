import type { MutationResolvers, Comment, DiscussionChannel } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { Selection, SelectedResolver } from "./selection.js";

// This is the explicit response subset supplied by regular vote mutations.
// Edges/pageInfo and other entity fields are not certified by this pilot.
export const voteResponseSelection = {
  id: true,
  weightedVotesCount: true,
  UpvotedByUsers: { username: true },
  UpvotedByUsersConnection: {
    totalCount: true,
    aggregate: { count: { nodes: true } },
  },
} as const satisfies Selection<Comment> & Selection<DiscussionChannel>;

export const votingMutationNames = [
  "upvoteComment", "undoUpvoteComment",
  "upvoteDiscussionChannel", "undoUpvoteDiscussionChannel",
] as const;
export type VotingMutationName = typeof votingMutationNames[number];
export type VotingMutationResolvers = {
  upvoteComment: SelectedResolver<MutationResolvers<GraphQLContext>["upvoteComment"], typeof voteResponseSelection>;
  undoUpvoteComment: SelectedResolver<MutationResolvers<GraphQLContext>["undoUpvoteComment"], typeof voteResponseSelection>;
  upvoteDiscussionChannel: SelectedResolver<MutationResolvers<GraphQLContext>["upvoteDiscussionChannel"], typeof voteResponseSelection>;
  undoUpvoteDiscussionChannel: SelectedResolver<MutationResolvers<GraphQLContext>["undoUpvoteDiscussionChannel"], typeof voteResponseSelection>;
};
