import { getUserWikiEditsCountQuery } from "../cypher/cypherQueries.js";
import type { Driver } from "neo4j-driver";
import type { UserModel } from "../../ogm_types.js";
import { logger } from "../../logger.js";

type Input = {
  User: UserModel;
  driver: Driver;
};

type Args = {
  username: string;
};

const getUserWikiEditsCountResolver = (input: Input) => {
  const { driver, User } = input;

  return async (_parent: unknown, args: Args) => {
    const { username } = args;
    const session = driver.session({ defaultAccessMode: "READ" });

    try {
      const userExists = await User.find({
        where: { username },
        selectionSet: `{ username }`,
      });

      if (userExists.length === 0) {
        throw new Error(`User ${username} not found.`);
      }

      const result = await session.run(getUserWikiEditsCountQuery, { username });
      const firstRecord = result.records[0];
      const count = firstRecord?.get("count");
      return count?.toNumber ? count.toNumber() : Number(count ?? 0);
    } catch (error: unknown) {
      logger.error("Error fetching user wiki edits count:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to fetch wiki edits count for user ${username}: ${message}`
      );
    } finally {
      await session.close();
    }
  };
};

export default getUserWikiEditsCountResolver;
