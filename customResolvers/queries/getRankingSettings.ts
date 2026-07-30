import { GraphQLError } from "graphql";
import type { Driver } from "neo4j-driver";
import { findRankingSettings } from "../../services/rankingSettingsStore.js";

type Input = {
  driver: Driver;
};

type Args = {
  serverName: string;
};

export const getRankingSettings = ({ driver }: Input) => {
  return async (_parent: unknown, { serverName }: Args) => {
    const session = driver.session();

    try {
      const stored = await findRankingSettings({ executor: session, serverName });
      if (!stored) {
        throw new GraphQLError("Server configuration not found.");
      }

      return {
        ...stored.settings,
        updatedAt: stored.updatedAt,
        updatedBy: stored.updatedBy,
      };
    } finally {
      await session.close();
    }
  };
};

export default getRankingSettings;
