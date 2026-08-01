import { randomUUID } from "node:crypto";
import { GraphQLError } from "graphql";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import {
  normalizeDiscussionFlairConfig,
  type DiscussionFlairConfigInput,
} from "../../services/discussionFlairConfig.js";
import { findChannelDiscussionFlairConfig } from "../../services/discussionFlairStore.js";
import { logger } from "../../logger.js";

type Input = {
  driver: Driver;
  createId?: () => string;
};

type Args = {
  channelUniqueName: string;
  flairRequired: boolean;
  flairs: DiscussionFlairConfigInput[];
};

export const setChannelDiscussionFlairConfig = ({
  driver,
  createId = randomUUID,
}: Input) => {
  return async (
    _parent: unknown,
    { channelUniqueName, flairRequired, flairs }: Args,
    context: GraphQLContext
  ) => {
    const normalizedChannelName = channelUniqueName?.trim();
    if (!normalizedChannelName) {
      throw new GraphQLError("Channel unique name is required.");
    }

    const normalizedFlairs = normalizeDiscussionFlairConfig(
      flairs,
      flairRequired
    );
    const session = driver.session();

    try {
      return await session.executeWrite(async (transaction) => {
        const existingConfig = await findChannelDiscussionFlairConfig({
          executor: transaction,
          channelUniqueName: normalizedChannelName,
          includeArchived: true,
        });

        if (!existingConfig) {
          throw new GraphQLError("Channel not found.", {
            extensions: { code: "CHANNEL_NOT_FOUND" },
          });
        }

        const existingIds = new Set(
          existingConfig.flairs.map((flair) => flair.id)
        );
        for (const flair of normalizedFlairs) {
          if (flair.id && !existingIds.has(flair.id)) {
            throw new GraphQLError(
              `Flair '${flair.id}' does not belong to channel '${normalizedChannelName}'.`,
              { extensions: { code: "INVALID_DISCUSSION_FLAIR" } }
            );
          }
        }

        const persistedFlairs = normalizedFlairs.map((flair) => ({
          ...flair,
          id: flair.id ?? createId(),
        }));
        const submittedIds = persistedFlairs.map((flair) => flair.id);
        const existingFlairUpdates = persistedFlairs.filter((flair) =>
          existingIds.has(flair.id)
        );
        const newFlairs = persistedFlairs.filter(
          (flair) => !existingIds.has(flair.id)
        );

        await transaction.run(
          `
            MATCH (channel:Channel {uniqueName: $channelUniqueName})
            SET channel.discussionFlairRequired = $flairRequired
            WITH channel
            OPTIONAL MATCH (channel)-[:HAS_DISCUSSION_FLAIR]->(existing:DiscussionFlair)
            FOREACH (_ IN CASE
              WHEN existing IS NOT NULL AND NOT existing.id IN $submittedIds
              THEN [1]
              ELSE []
            END | SET existing.archived = true)
            RETURN channel.uniqueName AS channelUniqueName
          `,
          {
            channelUniqueName: normalizedChannelName,
            flairRequired,
            submittedIds,
          }
        );

        if (existingFlairUpdates.length > 0) {
          await transaction.run(
            `
              MATCH (channel:Channel {uniqueName: $channelUniqueName})
              UNWIND $flairs AS flairInput
              MATCH (channel)-[:HAS_DISCUSSION_FLAIR]->(flair:DiscussionFlair {
                id: flairInput.id,
                channelUniqueName: $channelUniqueName
              })
              SET flair.displayName = flairInput.displayName,
                  flair.color = flairInput.color,
                  flair.order = flairInput.order,
                  flair.archived = flairInput.archived
            `,
            {
              channelUniqueName: normalizedChannelName,
              flairs: existingFlairUpdates,
            }
          );
        }

        if (newFlairs.length > 0) {
          await transaction.run(
            `
              MATCH (channel:Channel {uniqueName: $channelUniqueName})
              UNWIND $flairs AS flairInput
              CREATE (flair:DiscussionFlair {
                id: flairInput.id,
                channelUniqueName: $channelUniqueName,
                displayName: flairInput.displayName,
                color: flairInput.color,
                order: flairInput.order,
                archived: flairInput.archived
              })
              CREATE (channel)-[:HAS_DISCUSSION_FLAIR]->(flair)
            `,
            {
              channelUniqueName: normalizedChannelName,
              flairs: newFlairs,
            }
          );
        }

        const updatedConfig = await findChannelDiscussionFlairConfig({
          executor: transaction,
          channelUniqueName: normalizedChannelName,
          includeArchived: true,
        });

        if (!updatedConfig) {
          throw new GraphQLError("Channel not found.", {
            extensions: { code: "CHANNEL_NOT_FOUND" },
          });
        }

        logger.info("Channel discussion flair configuration updated", {
          channelUniqueName: normalizedChannelName,
          updatedBy: context.user?.username ?? null,
          flairRequired,
          activeFlairCount: persistedFlairs.filter(
            (flair) => !flair.archived
          ).length,
        });

        return updatedConfig;
      });
    } finally {
      await session.close();
    }
  };
};

export default setChannelDiscussionFlairConfig;
