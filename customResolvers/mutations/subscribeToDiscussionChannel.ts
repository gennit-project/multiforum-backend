import type { GraphQLResolveInfo } from "graphql";
import type { Driver } from "neo4j-driver";
import type { DiscussionChannelModel } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";

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

    console.log('=== DEBUG: subscribeToDiscussionChannel called with:', {
      discussionChannelId,
      username
    });

    if (!username) {
      console.error('=== DEBUG ERROR: Authentication required for subscription');
      throw new Error("Authentication required");
    }

    const session = driver.session();

    try {
      console.log('=== DEBUG: Creating subscription relationship');
      
      // Connect user to SubscribedToNotifications
      const subscriptionResult = await session.run(
        `
        MATCH (dc:DiscussionChannel {id: $discussionChannelId})
        MATCH (u:User {username: $username})
        MERGE (u)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(dc)
        RETURN dc.id as discussionChannelId, u.username as subscribedUsername
        `,
        { discussionChannelId, username }
      );
      
      console.log('=== DEBUG: Subscription creation result:', {
        recordsCount: subscriptionResult.records.length,
        firstRecord: subscriptionResult.records[0] ? {
          discussionChannelId: subscriptionResult.records[0].get('discussionChannelId'),
          subscribedUsername: subscriptionResult.records[0].get('subscribedUsername')
        } : null
      });

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

      console.log('=== DEBUG: Subscription successful, returning DiscussionChannel:', {
        id: result[0]?.id,
        subscribedUsersCount: result[0]?.SubscribedToNotifications?.length || 0
      });
      
      return result[0];
    } catch (error: unknown) {
      console.error('=== DEBUG ERROR: Error subscribing to discussion channel:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to subscribe to discussion channel: ${message}`);
    } finally {
      session.close();
    }
  };
};

export default getResolver;