import { commentIsUpvotedByUserQuery } from "../cypher/cypherQueries.js";
import { getWeightedVoteBonus } from "./utils.js";
import type { GraphQLResolveInfo } from "graphql";
import type { Driver } from "neo4j-driver";
import type { CommentModel, UserModel } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
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

const upvoteCommentResolver = (input: Input) => {
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
      const upvotedByUser = singleRecord.get("result").upvotedByUser;

      if (upvotedByUser) {
        throw new Error("You have already upvoted this comment");
      }
      // Fetch comment
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

      // Fetch data of the user who is upvoting the comment
      // because we need it to calculate the weighted vote bonus.
      const userSelectionSet = `
      {
          username
          commentKarma
      }
     `;
      const upvoterUserResult = await User.find({
        where: {
          username,
        },
        selectionSet: userSelectionSet,
      });

      if (upvoterUserResult.length === 0) {
        throw new Error("User not found");
      }

      const upvoterUser = upvoterUserResult[0];

      const weightedVoteBonus = getWeightedVoteBonus(upvoterUser);

      // Update weighted votes count on the comment
      // and create a relationship between the user and the comment.
      const updateCommentQuery = `
        MATCH (c:Comment { id: $commentId }), (u:User { username: $username })
        SET c.weightedVotesCount = coalesce(c.weightedVotesCount, 0) + 1 + $weightedVoteBonus
        CREATE (u)-[:UPVOTED_COMMENT]->(c)
        RETURN c
      `;

      await tx.run(updateCommentQuery, {
        commentId,
        username,
        weightedVoteBonus,
      });

      // Update the post author's karma
      if (postAuthorUsername) {
        await User.update({
          where: { username: postAuthorUsername },
          update: { commentKarma: postAuthorKarma + 1 },
        });
      }

      await tx.commit();

      const existingUpvotedByUsers = comment.UpvotedByUsers || [];
      const existingUpvotedByUsersCount = comment.UpvotedByUsersAggregate?.count || 0;

      return {
        id: commentId,
        weightedVotesCount: (comment.weightedVotesCount ?? 0) + 1 + weightedVoteBonus,
        UpvotedByUsers: [
          ...existingUpvotedByUsers,
          {
            username,
          },
        ],
        UpvotedByUsersAggregate: {
          count: existingUpvotedByUsersCount + 1,
        },
      };
    } catch (e) {
      if (tx) {
        try {
          await tx.rollback();
        } catch (rollbackError) {
          logger.error("Failed to rollback transaction", rollbackError);
        }
      }
      logger.error(e);
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

export default upvoteCommentResolver;
