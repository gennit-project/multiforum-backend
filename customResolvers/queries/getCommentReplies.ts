import type { GraphQLResolveInfo } from "graphql";
import type { Driver, Record as Neo4jRecord } from "neo4j-driver";
import { getCommentRepliesQuery } from "../cypher/cypherQueries.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { populateCommentSubscriptionStatus } from "./commentSubscriptionStatus.js";
import type { GraphQLContext } from "../../types/context.js";
import type { CommentModel } from "../../ogm_types.js";
import { logger } from "../../logger.js";

type Input = {
  Comment: CommentModel;
  driver: Driver;
};

type Args = {
  commentId: string;
  modName: string;
  offset: string;
  limit: string;
  sort: string;
};

const getResolver = (input: Input) => {
  const { driver, Comment } = input;
  return async (parent: unknown, args: Args, context: GraphQLContext, info: GraphQLResolveInfo) => {
    const { commentId, modName, offset, limit, sort } = args;
    context.user = await setUserDataOnContext({
      context,
    });
    const loggedInUsername = context.user?.username || null;

    const session = driver.session();

    try {
      let commentsResult = [];
      let aggregateCount = 0;

      const commentRepliesResult = await session.run(getCommentRepliesQuery, {
        commentId,
        modName,
        offset: parseInt(offset, 10),
        limit: parseInt(limit, 10),
        sortOption: sort === "top" ? "top" : sort === "hot" ? "hot" : "new",
        loggedInUsername,
      });

      if (commentRepliesResult.records.length === 0) {
        return {
          ChildComments: [],
          aggregateChildCommentCount: 0,
        };
      }

      commentsResult = commentRepliesResult.records.map((record: Neo4jRecord) => {
        return record.get("ChildComments");
      });

      commentsResult = await populateCommentSubscriptionStatus({
        comments: commentsResult,
        loggedInUsername,
        session,
      });

      aggregateCount = await Comment.aggregate({
        where: {
          ParentComment: {
            id: commentId,
          },
        },
        aggregate: {
          count: true,
        },
      }).then((result: { count: number }) => {
        return result.count;
      });

      return {
        ChildComments: commentsResult,
        aggregateChildCommentCount: aggregateCount || 0,
      };
    } catch (error: unknown) {
      logger.error("Error getting comment section:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch comment section. ${message}`);
    } finally {
      session.close();
    }
  };
};

export default getResolver;
