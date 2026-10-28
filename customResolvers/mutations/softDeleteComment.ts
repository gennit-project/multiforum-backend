import type { Driver } from "neo4j-driver";
import { GraphQLError } from "graphql";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import { executeGeneratedOperation } from "../../services/persistence/generatedSchemaOperations.js";

// v7 (campaign #284): soft-delete/anonymize a comment. v7's CommentUpdateInput
// no longer carries the to-one CommentAuthor union, so updateComments can't
// disconnect the author. This replaces the text ("[Deleted]") via the generated
// update and owns the AUTHORED_COMMENT removal.
const UPDATE_TEXT = `mutation SoftDeleteCommentText($where: CommentWhere, $update: CommentUpdateInput) {
  updateComments(where: $where, update: $update) {
    comments { id text weightedVotesCount createdAt updatedAt }
  }
}`;

// CommentAuthor is a GraphQL union (User | ModerationProfile), not a Neo4j
// label, so match the AUTHORED_COMMENT edge by type alone.
const DISCONNECT_AUTHOR = `
 MATCH ()-[r:AUTHORED_COMMENT]->(:Comment {id: $id})
 DELETE r
`;

type Args = { where?: { id?: { eq?: string | null } | null } | null };
type Input = { driver: Driver };

const getResolver = (deps: Input) => {
  const { driver } = deps;
  return async (_parent: unknown, args: Args, _context: GraphQLContext, _info: GraphQLResolveInfo) => {
    const id = args.where?.id?.eq;
    if (!id) throw new GraphQLError("softDeleteComment requires where.id.eq");
    // Own the author disconnect first so the returned comment projects a null
    // CommentAuthor, then set the deleted text via the generated mutation.
    await driver.executeQuery(DISCONNECT_AUTHOR, { id });
    const result = await executeGeneratedOperation<{ updateComments: { comments: Array<{ id: string }> } }>(
      driver,
      UPDATE_TEXT,
      { where: { id: { eq: id } }, update: { text: { set: "[Deleted]" } } }
    );
    return result.updateComments;
  };
};

export default getResolver;
