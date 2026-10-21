import neo4j, { type Driver } from "neo4j-driver";
import { resolveNeo4jDatabase } from "../neo4jDatabase.js";

/** Existence checks preceding the contribution aggregations. */
export interface ContributionTargetRepository {
  userExists(username: string): Promise<boolean>;
  moderationProfileExists(displayName: string): Promise<boolean>;
  channelExists(uniqueName: string): Promise<boolean>;
}

export const CONTRIBUTION_USER_EXISTS_QUERY = `
  MATCH (:User {username: $name})
  RETURN true AS exists
  LIMIT 1
`;

export const CONTRIBUTION_MODERATION_PROFILE_EXISTS_QUERY = `
  MATCH (:ModerationProfile {displayName: $name})
  RETURN true AS exists
  LIMIT 1
`;

export const CONTRIBUTION_CHANNEL_EXISTS_QUERY = `
  MATCH (:Channel {uniqueName: $name})
  RETURN true AS exists
  LIMIT 1
`;

export function createContributionTargetRepository(
  driver: Driver,
  database = resolveNeo4jDatabase()
): ContributionTargetRepository {
  const exists = async (query: string, name: string): Promise<boolean> => {
    // These checks replace OGM find queries, which used managed READ
    // transactions and the driver's shared bookmark manager. Keep them
    // separate from the following aggregation's existing auto-commit session.
    const session = driver.session({
      database,
      defaultAccessMode: neo4j.session.READ,
      bookmarkManager: driver.executeQueryBookmarkManager,
    });
    try {
      const result = await session.executeRead((tx) => tx.run(query, { name }));
      return result.records[0]?.get("exists") === true;
    } finally {
      await session.close();
    }
  };

  return {
    userExists: (username) => exists(CONTRIBUTION_USER_EXISTS_QUERY, username),
    moderationProfileExists: (displayName) =>
      exists(CONTRIBUTION_MODERATION_PROFILE_EXISTS_QUERY, displayName),
    channelExists: (uniqueName) =>
      exists(CONTRIBUTION_CHANNEL_EXISTS_QUERY, uniqueName),
  };
}
