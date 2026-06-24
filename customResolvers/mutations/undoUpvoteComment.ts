import { User } from "../../src/generated/graphql";
import type { GraphQLResolveInfo } from "graphql";
import type { Driver } from "neo4j-driver";
import type { CommentModel, UserModel } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import { commentIsUpvotedByUserQuery } from "../cypher/cypherQueries.js";
import { getWeightedVoteBonus } from "./utils.js";
import { logger } from "../../logger.js";

type Input = {
  Comment: CommentModel;
  User: UserModel;
  driver: Driver;
};

type Args = {
  commentId: string;
  username: string;
};

const undoUpvoteCommentResolver = (input: Input) => {
  const { Comment, User, driver } = input;

  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext,
    resolveInfo: GraphQLResolveInfo
  ) => {
    const { commentId, username } = args;

    if (!commentId || !username) {
      throw new Error("All arguments (commentId, username) are required");
    }

    const session = driver.session();

    const tx = session.beginTransaction();

    try {
      const result = await tx.run(commentIsUpvotedByUserQuery, {
        username,
        commentId,
      });
      
      const singleRecord = result.records[0];
      
      if (!singleRecord) {
        throw new Error("Comment not found");
      }
      
      const upvotedByUser = singleRecord.get("result")?.upvotedByUser;

      if (!upvotedByUser) {
        throw new Error(
          "Can't undo upvote because you haven't upvoted this comment yet"
        );
      }
      
      const commentSelectionSet = `
        {
          id
          CommentAuthor {
              ... on User {
                  username
                  commentKarma
                  createdAt
              }
              ... on ModerationProfile {
                displayName
                createdAt
              }
          }
          weightedVotesCount
          UpvotedByUsers {
              username
          }
          UpvotedByUsersAggregate {
              count
          }
        }
      `;

      const commentResult = await Comment.find({
        where: {
          id: commentId,
        },
        selectionSet: commentSelectionSet,
      });

      if (commentResult.length === 0) {
        throw new Error("Comment not found");
      }

      const comment = commentResult[0];

      const commentAuthor = comment.CommentAuthor;
      const postAuthorUsername =
        commentAuthor && "username" in commentAuthor
          ? commentAuthor.username
          : undefined;
      const postAuthorKarma =
        commentAuthor && "commentKarma" in commentAuthor
          ? commentAuthor.commentKarma || 0
          : 0;
      const userSelectionSet = `
      {
          username
          commentKarma
      }
     `;
      const voterUserResult = await User.find({
        where: {
          username,
        },
        selectionSet: userSelectionSet,
      });

      if (voterUserResult.length === 0) {
        throw new Error(
          "User data not found for the user who is undoing the upvote"
        );
      }

      const voterUser = voterUserResult[0];

      let weightedVoteBonus = getWeightedVoteBonus(voterUser);

      const undoUpvoteCommentQuery = `
       MATCH (u:User { username: $username })-[r:UPVOTED_COMMENT]->(c:Comment { id: $commentId })
       SET c.weightedVotesCount = coalesce(c.weightedVotesCount, 0) - 1 - $weightedVoteBonus
       DELETE r
       RETURN c
     `;

      await tx.run(undoUpvoteCommentQuery, {
        commentId,
        username,
        weightedVoteBonus,
      });

      if (postAuthorUsername) {
        await User.update({
          where: { username: postAuthorUsername },
          update: { commentKarma: postAuthorKarma - 1 },
        });
      }

      await tx.commit();

      const existingUpvotedByUsers = comment.UpvotedByUsers || [];
      const existingUpvotedByUsersAggregate =
        comment.UpvotedByUsersAggregate || { count: 0 };

      const returnValue = {
        id: commentId,
        weightedVotesCount: (comment.weightedVotesCount ?? 0) - 1 - weightedVoteBonus,
        UpvotedByUsers: existingUpvotedByUsers.filter(
          (user: User) => user.username !== username
        ),
        UpvotedByUsersAggregate: {
          count: existingUpvotedByUsersAggregate.count - 1,
        },
      };
      return returnValue;
    } catch (e) {
      logger.error("Error in undoUpvoteComment:", e);
      if (tx) {
        try {
          await tx.rollback();
        } catch (rollbackError) {
          logger.error("Failed to rollback transaction", rollbackError);
        }
      }
      throw e; // Re-throw the error after logging
    } finally {
      if (session) {
        try {
          session.close();
        } catch (sessionCloseError) {
          logger.error("Failed to close session", sessionCloseError);
        }
      }
    }
  };
};

export default undoUpvoteCommentResolver;
