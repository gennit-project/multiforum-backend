import { getCommentRepliesQuery } from "../cypher/cypherQueries.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { populateCommentSubscriptionStatus } from "./commentSubscriptionStatus.js";

type Input = {
  Comment: any;
  driver: any;
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
  return async (parent: any, args: Args, context: any, info: any) => {
    const { commentId, modName, offset, limit, sort } = args;
    context.user = await setUserDataOnContext({
      context,
      getPermissionInfo: false,
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

      commentsResult = commentRepliesResult.records.map((record: any) => {
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
      }).then((result: any) => {
        return result.count;
      });

      return {
        ChildComments: commentsResult,
        aggregateChildCommentCount: aggregateCount || 0,
      };
    } catch (error: any) {
      console.error("Error getting comment section:", error);
      throw new Error(`Failed to fetch comment section. ${error.message}`);
    } finally {
      session.close();
    }
  };
};

export default getResolver;
