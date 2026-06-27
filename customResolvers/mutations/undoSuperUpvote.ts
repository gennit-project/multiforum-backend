import type { Driver } from "neo4j-driver";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import { logger } from "../../logger.js";
import type {
  CommentModel,
  DiscussionChannelModel,
  ScratchpadEntryModel,
} from "../../ogm_types.js";

type Input = {
  Comment: CommentModel;
  DiscussionChannel: DiscussionChannelModel;
  ScratchpadEntry: ScratchpadEntryModel;
  driver: Driver;
};

type Args = {
  sourceType: 'comment' | 'discussion';
  sourceId: string;
};

const undoSuperUpvoteResolver = (input: Input) => {
  // ScratchpadEntry intentionally unused: the entry is deleted via Cypher inside
  // the transaction (below) so it is atomic with the relationship/weight/karma.
  const { Comment, DiscussionChannel, driver } = input;

  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { sourceType, sourceId } = args;

    // Get logged in user from context
    const loggedInUsername = context.user?.username;
    if (!loggedInUsername) {
      throw new Error('You must be logged in to undo a super upvote');
    }

    if (!sourceType || !sourceId) {
      throw new Error('sourceType and sourceId are required');
    }

    if (sourceType !== 'comment' && sourceType !== 'discussion') {
      throw new Error('sourceType must be "comment" or "discussion"');
    }

    const session = driver.session();
    const tx = session.beginTransaction();

    try {
      // 1. Verify the user has super upvoted this content, and capture the
      //    content author (a User) so we can reverse the karma we awarded.
      let hasSuperUpvoted = false;
      let postAuthorUsername: string | null = null;

      if (sourceType === 'comment') {
        const commentResult = await Comment.find({
          where: { id: sourceId },
          selectionSet: `{
            id
            SuperUpvotedByUsers { username }
            CommentAuthor {
              ... on User { username }
            }
          }`,
        });

        if (commentResult.length === 0) {
          throw new Error('Comment not found');
        }

        const comment = commentResult[0];
        hasSuperUpvoted = comment.SuperUpvotedByUsers?.some((u: { username: string }) => u.username === loggedInUsername) || false;
        const commentAuthor = comment.CommentAuthor;
        postAuthorUsername =
          commentAuthor && 'username' in commentAuthor ? commentAuthor.username : null;
      } else {
        // sourceType === 'discussion'
        const dcResult = await DiscussionChannel.find({
          where: { id: sourceId },
          selectionSet: `{
            id
            SuperUpvotedByUsers { username }
            Discussion { Author { username } }
          }`,
        });

        if (dcResult.length === 0) {
          throw new Error('Discussion not found');
        }

        const dc = dcResult[0];
        hasSuperUpvoted = dc.SuperUpvotedByUsers?.some((u: { username: string }) => u.username === loggedInUsername) || false;
        postAuthorUsername = dc.Discussion?.Author?.username || null;
      }

      if (!hasSuperUpvoted) {
        throw new Error('You have not super upvoted this content');
      }

      // 2. Remove the SUPER_UPVOTED relationship and reverse the weight.
      if (sourceType === 'comment') {
        await tx.run(
          `MATCH (u:User { username: $username })-[r:SUPER_UPVOTED_COMMENT]->(c:Comment { id: $sourceId })
           DELETE r
           SET c.weightedVotesCount = coalesce(c.weightedVotesCount, 1) - 1`,
          { sourceId, username: loggedInUsername }
        );
      } else {
        await tx.run(
          `MATCH (u:User { username: $username })-[r:SUPER_UPVOTED_DISCUSSION]->(dc:DiscussionChannel { id: $sourceId })
           DELETE r
           SET dc.weightedVotesCount = coalesce(dc.weightedVotesCount, 1) - 1`,
          { sourceId, username: loggedInUsername }
        );
      }

      // 3. Reverse the karma the super upvote awarded to the content author.
      if (postAuthorUsername) {
        const karmaField = sourceType === 'comment' ? 'commentKarma' : 'discussionKarma';
        await tx.run(
          `MATCH (a:User { username: $postAuthorUsername })
           SET a.${karmaField} = coalesce(a.${karmaField}, 0) - 1`,
          { postAuthorUsername }
        );
      }

      // 4. Delete the associated scratchpad entry (in the transaction, so it is
      //    atomic with the relationship/weight/karma changes above).
      await tx.run(
        `MATCH (:User { username: $username })-[:WROTE_SCRATCHPAD_ENTRY]->(e:ScratchpadEntry { sourceType: $sourceType, sourceId: $sourceId })
         DETACH DELETE e`,
        { username: loggedInUsername, sourceType, sourceId }
      );

      // 5. Read the updated super-upvoter list inside the same transaction so it
      //    reflects the relationship we just deleted. A post-commit read on a
      //    fresh OGM session can lag behind the write on a clustered database.
      const readSuperUpvotersQuery =
        sourceType === 'comment'
          ? `MATCH (u:User)-[:SUPER_UPVOTED_COMMENT]->(:Comment { id: $sourceId })
             RETURN collect({ username: u.username }) AS users`
          : `MATCH (u:User)-[:SUPER_UPVOTED_DISCUSSION]->(:DiscussionChannel { id: $sourceId })
             RETURN collect({ username: u.username }) AS users`;
      const superUpvotersResult = await tx.run(readSuperUpvotersQuery, { sourceId });
      const superUpvotedByUsers: Array<{ username: string }> =
        superUpvotersResult.records[0]?.get('users') || [];

      await tx.commit();

      return {
        success: true,
        message: 'Super upvote removed successfully',
        sourceId,
        sourceType,
        superUpvotedByUsers,
      };
    } catch (e) {
      if (tx) {
        try {
          await tx.rollback();
        } catch (rollbackError) {
          logger.error('Failed to rollback transaction', rollbackError);
        }
      }
      throw e;
    } finally {
      if (session) {
        try {
          await session.close();
        } catch (sessionCloseError) {
          logger.error('Failed to close session', sessionCloseError);
        }
      }
    }
  };
};

export default undoSuperUpvoteResolver;
