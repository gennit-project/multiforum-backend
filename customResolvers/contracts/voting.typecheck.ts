// Compiled by the existing tsc gate, never executed. Unused @ts-expect-error
// directives fail compilation if these boundaries regress to permissive types.
import type { VotingMutationResolvers } from "./voting.js";
import type { SelectedResolver } from "./selection.js";
import type { ResolverFn } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { CommentVoterSnapshot } from "../../services/persistence/commentVoteRepository.js";
import type { DiscussionVoterSnapshot } from "../../services/persistence/discussionChannelVoteRepository.js";

type Vote = VotingMutationResolvers["upvoteComment"];
const valid: Vote = async (_parent, args, context) => {
  const appContext: GraphQLContext = context;
  void appContext;
  return { id: args.commentId, weightedVotesCount: null, UpvotedByUsers: [],
    UpvotedByUsersConnection: { totalCount: 0, aggregate: { count: { nodes: 0 } } } };
};
const absent: Vote = async () => undefined;
const nullable: Vote = () => null;
// @ts-expect-error string is not a vote count
const wrongScalar: Vote = async () => ({ id: "c", weightedVotesCount: "one", UpvotedByUsers: [], UpvotedByUsersConnection: { totalCount: 1, aggregate: { count: { nodes: 1 } } } });
// @ts-expect-error selected connection fields cannot be omitted
const missingConnection: Vote = async () => ({ id: "c", UpvotedByUsers: [] });
// @ts-expect-error connection count cannot be null
const nullCount: Vote = async () => ({ id: "c", weightedVotesCount: 0, UpvotedByUsers: [], UpvotedByUsersConnection: { totalCount: null, aggregate: { count: { nodes: 0 } } } });
// @ts-expect-error generated required arguments are enforced
const wrongArgs: Vote = async (_parent, args: { commentId: number }) => null;
// @ts-expect-error removed/unknown schema fields are not a selection
export type UnknownField = SelectedResolver<ResolverFn<{ id: string }, unknown, GraphQLContext, { id: string }>, { missing: true }>;
type Required = SelectedResolver<ResolverFn<{ id: string }, unknown, GraphQLContext, { id: string }>, { id: true }>;
// @ts-expect-error undefined is only accepted for nullable generated results
const missingRequired: Required = () => undefined;
function repositorySelections(comment: CommentVoterSnapshot, discussion: DiscussionVoterSnapshot) {
  // @ts-expect-error createdAt is not fetched by this repository operation
  void comment.createdAt;
  // @ts-expect-error commentKarma is not fetched by the discussion voter operation
  void discussion.commentKarma;
}
void [valid, absent, nullable, wrongScalar, missingConnection, nullCount, wrongArgs, missingRequired, repositorySelections];
