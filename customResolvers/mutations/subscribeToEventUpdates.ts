type Args = {
  eventId: string;
};

type Input = {
  Event: any;
  driver: any;
};

const getResolver = (input: Input) => {
  const { Event, driver } = input;

  return async (parent: any, args: Args, context: any) => {
    const { eventId } = args;
    const { username } = context.user;

    if (!username) {
      throw new Error("Authentication required");
    }

    const session = driver.session();

    try {
      await session.run(
        `
        MATCH (e:Event {id: $eventId})
        MATCH (u:User {username: $username})
        MERGE (u)-[:SUBSCRIBED_TO_EVENT_UPDATES]->(e)
        `,
        { eventId, username }
      );

      const result = await Event.find({
        where: { id: eventId },
        selectionSet: `{
          id
          title
          createdAt
          SubscribedToEventUpdates {
            username
          }
        }`,
      });

      return result[0];
    } catch (error: any) {
      console.error("Error subscribing to event updates:", error);
      throw new Error(`Failed to subscribe to event updates: ${error.message}`);
    } finally {
      session.close();
    }
  };
};

export default getResolver;
