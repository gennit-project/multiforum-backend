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
      // Disconnect user from SubscribedToNotifications
      await session.run(
        `
        MATCH (i:Issue {id: $issueId})
        MATCH (u:User {username: $username})
        OPTIONAL MATCH (u)-[r:SUBSCRIBED_TO_NOTIFICATIONS]->(i)
        DELETE r
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
      console.error("Error unsubscribing from issue:", error);
      throw new Error(`Failed to unsubscribe from issue: ${error.message}`);
    } finally {
      session.close();
    }
  };
};

export default getResolver;
