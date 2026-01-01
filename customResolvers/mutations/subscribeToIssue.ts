type Args = {
  issueId: string;
};

type Input = {
  Issue: any;
  driver: any;
};

const getResolver = (input: Input) => {
  const { Issue, driver } = input;

  return async (parent: any, args: Args, context: any, info: any) => {
    const { issueId } = args;
    const { username } = context.user;

    if (!username) {
      throw new Error("Authentication required");
    }

    const session = driver.session();

    try {
      // Connect user to SubscribedToNotifications
      await session.run(
        `
        MATCH (i:Issue {id: $issueId})
        MATCH (u:User {username: $username})
        MERGE (u)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(i)
        `,
        { issueId, username }
      );

      // Return the updated Issue
      const result = await Issue.find({
        where: { id: issueId },
        selectionSet: `{
          id
          issueNumber
          reportText
          createdAt
          SubscribedToNotifications {
            username
          }
        }`
      });

      return result[0];
    } catch (error: any) {
      console.error("Error subscribing to issue:", error);
      throw new Error(`Failed to subscribe to issue: ${error.message}`);
    } finally {
      session.close();
    }
  };
};

export default getResolver;
