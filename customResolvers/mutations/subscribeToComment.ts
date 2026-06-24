import type { GraphQLResolveInfo } from "graphql";
import type { Driver } from "neo4j-driver";
import type { CommentModel } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";

type Args = {
  commentId: string;
};

type Input = {
  Comment: CommentModel;
  driver: Driver;
};

const getResolver = (input: Input) => {
  const { Comment, driver } = input;

  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext,
    info: GraphQLResolveInfo
  ) => {
    const { commentId } = args;
    const { username } = context.user!;

    if (!username) {
      throw new Error("Authentication required");
    }

    const session = driver.session();

    try {
      // Connect user to SubscribedToNotifications
      await session.run(
        `
        MATCH (c:Comment {id: $commentId})
        MATCH (u:User {username: $username})
        MERGE (u)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(c)
        `,
        { commentId, username }
      );

      // Return the updated Comment
      const result = await Comment.find({
        where: { id: commentId },
        selectionSet: `{
          id
          text
          createdAt
          SubscribedToNotifications {
            username
          }
        }`
      });

      return result[0];
    } catch (error: unknown) {
      console.error("Error subscribing to comment:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to subscribe to comment: ${message}`);
    } finally {
      session.close();
    }
  };
};

export default getResolver;