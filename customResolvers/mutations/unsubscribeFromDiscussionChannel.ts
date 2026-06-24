import type { GraphQLResolveInfo } from "graphql";
import type { Driver } from "neo4j-driver";
import type { DiscussionChannelModel } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import { logger } from "../../logger.js";

type Args = {
  discussionChannelId: string;
};

type Input = {
  DiscussionChannel: DiscussionChannelModel;
  driver: Driver;
};

const getResolver = (input: Input) => {
  const { DiscussionChannel, driver } = input;

  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext,
    info: GraphQLResolveInfo
  ) => {
    const { discussionChannelId } = args;
    const { username } = context.user!;

    if (!username) {
      throw new Error("Authentication required");
    }

    const session = driver.session();

    try {
      // Disconnect user from SubscribedToNotifications
      await session.run(
        `
        MATCH (dc:DiscussionChannel {id: $discussionChannelId})
        MATCH (u:User {username: $username})
        OPTIONAL MATCH (u)-[r:SUBSCRIBED_TO_NOTIFICATIONS]->(dc)
        DELETE r
        `,
        { discussionChannelId, username }
      );

      // Return the updated DiscussionChannel
      const result = await DiscussionChannel.find({
        where: { id: discussionChannelId },
        selectionSet: `{
          id
          discussionId
          channelUniqueName
          createdAt
          archived
          SubscribedToNotifications {
            username
          }
        }`
      });

      return result[0];
    } catch (error: unknown) {
      logger.error("Error unsubscribing from discussion channel:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to unsubscribe from discussion channel: ${message}`);
    } finally {
      session.close();
    }
  };
};

export default getResolver;