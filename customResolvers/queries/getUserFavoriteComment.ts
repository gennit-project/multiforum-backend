import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";

type Input = {
  driver: any;
};

type Args = {
  commentId: string;
};

const getResolver = (input: Input) => {
  const { driver } = input;
  return async (parent: any, args: Args, context: any, info: any) => {
    const { commentId } = args;

    context.user = await setUserDataOnContext({
      context,
      getPermissionInfo: false,
    });

    const loggedInUsername = context.user?.username || null;

    if (!loggedInUsername) {
      return false;
    }

    const session = driver.session();

    try {
      const result = await session.run(
        `
        MATCH (user:User { username: $username })-[:DEFAULT_FAVORITES_COMMENTS]->(comment:Comment { id: $commentId })
        RETURN COUNT(comment) > 0 AS isFavorited
        `,
        {
          username: loggedInUsername,
          commentId,
        }
      );

      const firstRecord = result.records[0];
      return firstRecord ? !!firstRecord.get("isFavorited") : false;
    } catch (error: any) {
      console.error("Error checking favorite comment:", error);
      throw new Error(`Failed to check favorite comment. ${error.message}`);
    } finally {
      session.close();
    }
  };
};

export default getResolver;
