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
  const { Comment, DiscussionChannel, ScratchpadEntry, driver } = input;

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
      // 1. Verify the user has super upvoted this content
      let hasSuperUpvoted = false;

      if (sourceType === 'comment') {
        const commentResult = await Comment.find({
          where: { id: sourceId },
          selectionSet: `{
            id
            SuperUpvotedByUsers { username }
          }`,
        });

        if (commentResult.length === 0) {
          throw new Error('Comment not found');
        }

        const comment = commentResult[0];
        hasSuperUpvoted = comment.SuperUpvotedByUsers?.some((u: { username: string }) => u.username === loggedInUsername) || false;
      } else {
        // sourceType === 'discussion'
        const dcResult = await DiscussionChannel.find({
          where: { id: sourceId },
          selectionSet: `{
            id
            SuperUpvotedByUsers { username }
          }`,
        });

        if (dcResult.length === 0) {
          throw new Error('Discussion not found');
        }

        const dc = dcResult[0];
        hasSuperUpvoted = dc.SuperUpvotedByUsers?.some((u: { username: string }) => u.username === loggedInUsername) || false;
      }

      if (!hasSuperUpvoted) {
        throw new Error('You have not super upvoted this content');
      }

      // 2. Remove the SUPER_UPVOTED relationship
      if (sourceType === 'comment') {
        const undoSuperUpvoteQuery = `
          MATCH (u:User { username: $username })-[r:SUPER_UPVOTED_COMMENT]->(c:Comment { id: $sourceId })
          DELETE r
          SET c.weightedVotesCount = coalesce(c.weightedVotesCount, 1) - 1
          RETURN c
        `;
        await tx.run(undoSuperUpvoteQuery, { sourceId, username: loggedInUsername });
      } else {
        const undoSuperUpvoteQuery = `
          MATCH (u:User { username: $username })-[r:SUPER_UPVOTED_DISCUSSION]->(dc:DiscussionChannel { id: $sourceId })
          DELETE r
          SET dc.weightedVotesCount = coalesce(dc.weightedVotesCount, 1) - 1
          RETURN dc
        `;
        await tx.run(undoSuperUpvoteQuery, { sourceId, username: loggedInUsername });
      }

      // 3. Delete the associated scratchpad entry
      await ScratchpadEntry.delete({
        where: {
          sourceType,
          sourceId,
          Author: { username: loggedInUsername },
        },
      });

      // Read the updated super-upvoter list inside the same transaction so it
      // reflects the relationship we just deleted. A post-commit read on a fresh
      // OGM session can lag behind the write on a clustered database.
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
