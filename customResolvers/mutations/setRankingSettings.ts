import { GraphQLError } from "graphql";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import { logger } from "../../logger.js";
import {
  applyRankingSettingsPatch,
  serializeRankingSettings,
  type RankingSettingsPatch,
} from "../../services/rankingSettings.js";
import { findRankingSettings } from "../../services/rankingSettingsStore.js";

type Input = {
  driver: Driver;
  now?: () => Date;
};

type Args = {
  serverName: string;
  input: RankingSettingsPatch;
};

const hasValues = (patch: RankingSettingsPatch) =>
  Object.values(patch.discussionHot ?? {}).length > 0 ||
  Object.values(patch.commentHot ?? {}).length > 0;

export const setRankingSettings = ({
  driver,
  now = () => new Date(),
}: Input) => {
  return async (
    _parent: unknown,
    { serverName, input }: Args,
    context: GraphQLContext
  ) => {
    if (!hasValues(input)) {
      throw new GraphQLError("At least one ranking setting must be provided.");
    }

    const session = driver.session();

    try {
      return await session.executeWrite(async (transaction) => {
        const stored = await findRankingSettings({
          executor: transaction,
          serverName,
        });
        if (!stored) {
          throw new GraphQLError("Server configuration not found.");
        }

        let updatedSettings;
        try {
          updatedSettings = applyRankingSettingsPatch(stored.settings, input);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new GraphQLError(message);
        }

        const updatedAt = now().toISOString();
        const updatedBy = context.user?.username ?? null;

        await transaction.run(
          `
            MATCH (serverConfig:ServerConfig {serverName: $serverName})
            SET serverConfig.rankingSettingsJson = $settingsJson,
                serverConfig.rankingSettingsUpdatedAt = datetime($updatedAt),
                serverConfig.rankingSettingsUpdatedBy = $updatedBy
          `,
          {
            serverName,
            settingsJson: serializeRankingSettings(updatedSettings),
            updatedAt,
            updatedBy,
          }
        );

        logger.info("Ranking settings updated", {
          serverName,
          updatedBy,
          previous: stored.settings,
          next: updatedSettings,
        });

        return {
          ...updatedSettings,
          updatedAt,
          updatedBy,
        };
      });
    } finally {
      await session.close();
    }
  };
};

export default setRankingSettings;
