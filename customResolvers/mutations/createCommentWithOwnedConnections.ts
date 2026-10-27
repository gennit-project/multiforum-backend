import type { Driver } from "neo4j-driver";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import { executeGeneratedOperation } from "../../services/persistence/generatedSchemaOperations.js";
import {
  splitOwnedCommentInput,
  ownCommentConnections,
} from "../../services/persistence/commentCreationWrite.js";

// v7 (campaign #284): replaces the generated createComments (which could no
// longer carry the to-one Author / DiscussionChannel / Event / Channel /
// ParentComment / feedback connects). The comment scalars are created through
// the generated mutation (for a correctly typed projection), then the edges are
// owned. Returns the generated { comments } shape so the comment middlewares
// (mentions / user-mentions / plugin pipeline) keep working unchanged.
const CREATE_COMMENTS = `mutation OwnedCreateComments($input: [CommentCreateInput!]!) {
  createComments(input: $input) {
    comments {
      id
      text
      isRootComment
      isFeedbackComment
      deleted
      archived
      weightedVotesCount
      botMentions
      createdAt
    }
  }
}`;

type OwnedCommentInput = Record<string, unknown>;
type Args = { input: OwnedCommentInput[] };
type Input = { driver: Driver };

const getResolver = (deps: Input) => {
  const { driver } = deps;
  return async (
    _parent: unknown,
    args: Args,
    _context: GraphQLContext,
    _info: GraphQLResolveInfo
  ) => {
    const inputs = Array.isArray(args.input) ? args.input : [];
    const split = inputs.map((input) => splitOwnedCommentInput(input));

    const result = await executeGeneratedOperation<{
      createComments: { comments: Array<{ id: string }> };
    }>(driver, CREATE_COMMENTS, { input: split.map((entry) => entry.scalars) });

    const comments = result.createComments.comments ?? [];
    // Own each comment's to-one edges (author / container / parent / feedback).
    // Done one at a time so each runs in its own reconciled transaction.
    for (let index = 0; index < comments.length; index++) {
      const id = comments[index]?.id;
      if (id) await ownCommentConnections(driver, id, split[index].targets);
    }

    return { comments };
  };
};

export default getResolver;
