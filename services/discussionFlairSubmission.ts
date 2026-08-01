import { GraphQLError } from "graphql";
import type { Record as Neo4jRecord } from "neo4j-driver";
import type { CypherExecutor } from "./discussionFlairStore.js";

export type DiscussionChannelFlairSelectionInput = {
  channelUniqueName: string;
  flairIds: string[];
};

export type ChannelDiscussionFlairRequirements = {
  channelUniqueName: string;
  flairRequired: boolean;
  activeFlairIds: Set<string>;
};

const invalidSelection = (
  message: string,
  channelUniqueName?: string
) =>
  new GraphQLError(message, {
    extensions: {
      code: "INVALID_DISCUSSION_FLAIR",
      ...(channelUniqueName ? { channelUniqueName } : {}),
    },
  });

export const loadChannelDiscussionFlairRequirements = async ({
  executor,
  channelUniqueNames,
}: {
  executor: CypherExecutor;
  channelUniqueNames: string[];
}): Promise<Map<string, ChannelDiscussionFlairRequirements>> => {
  const result = await executor.run(
    `
      UNWIND $channelUniqueNames AS requestedChannelUniqueName
      OPTIONAL MATCH (channel:Channel {uniqueName: requestedChannelUniqueName})
      OPTIONAL MATCH (channel)-[:HAS_DISCUSSION_FLAIR]->(flair:DiscussionFlair)
      WHERE coalesce(flair.archived, false) = false
      WITH requestedChannelUniqueName, channel, flair
      ORDER BY flair.order ASC, flair.displayName ASC
      RETURN requestedChannelUniqueName,
             channel IS NOT NULL AS channelExists,
             coalesce(channel.discussionFlairRequired, false) AS flairRequired,
             collect(flair.id) AS activeFlairIds
    `,
    { channelUniqueNames }
  );

  return new Map(
    result.records
      .filter((record: Neo4jRecord) => record.get("channelExists") === true)
      .map((record: Neo4jRecord) => {
        const channelUniqueName = record.get(
          "requestedChannelUniqueName"
        ) as string;
        return [
          channelUniqueName,
          {
            channelUniqueName,
            flairRequired: record.get("flairRequired") === true,
            activeFlairIds: new Set(
              (record.get("activeFlairIds") ?? []).filter(Boolean)
            ),
          },
        ];
      })
  );
};

export const validateDiscussionFlairSelections = ({
  channelConnections,
  channelFlairSelections = [],
  requirementsByChannel,
}: {
  channelConnections: string[];
  channelFlairSelections?: DiscussionChannelFlairSelectionInput[] | null;
  requirementsByChannel: Map<string, ChannelDiscussionFlairRequirements>;
}): Map<string, string[]> => {
  const connectedChannels = new Set<string>();
  for (const channelUniqueName of channelConnections) {
    if (!channelUniqueName?.trim()) {
      throw invalidSelection("Channel unique names cannot be empty.");
    }
    if (connectedChannels.has(channelUniqueName)) {
      throw invalidSelection(
        `Channel '${channelUniqueName}' was selected more than once.`,
        channelUniqueName
      );
    }
    connectedChannels.add(channelUniqueName);
  }

  const flairIdsByChannel = new Map<string, string[]>();
  for (const selection of channelFlairSelections ?? []) {
    const channelUniqueName = selection.channelUniqueName?.trim();
    if (!channelUniqueName || !connectedChannels.has(channelUniqueName)) {
      throw invalidSelection(
        `Flair selections must belong to one of the discussion's selected channels.`,
        channelUniqueName
      );
    }
    if (flairIdsByChannel.has(channelUniqueName)) {
      throw invalidSelection(
        `Flairs for channel '${channelUniqueName}' were submitted more than once.`,
        channelUniqueName
      );
    }

    const flairIds = selection.flairIds ?? [];
    if (new Set(flairIds).size !== flairIds.length || flairIds.some((id) => !id)) {
      throw invalidSelection(
        `Flair IDs for channel '${channelUniqueName}' must be non-empty and unique.`,
        channelUniqueName
      );
    }
    flairIdsByChannel.set(channelUniqueName, flairIds);
  }

  for (const channelUniqueName of connectedChannels) {
    const requirements = requirementsByChannel.get(channelUniqueName);
    if (!requirements) {
      throw new GraphQLError(`Channel '${channelUniqueName}' was not found.`, {
        extensions: { code: "CHANNEL_NOT_FOUND", channelUniqueName },
      });
    }

    const flairIds = flairIdsByChannel.get(channelUniqueName) ?? [];
    if (requirements.flairRequired && flairIds.length === 0) {
      throw new GraphQLError(
        `At least one flair is required for channel '${channelUniqueName}'.`,
        {
          extensions: {
            code: "DISCUSSION_FLAIR_REQUIRED",
            channelUniqueName,
          },
        }
      );
    }

    const invalidFlairId = flairIds.find(
      (flairId) => !requirements.activeFlairIds.has(flairId)
    );
    if (invalidFlairId) {
      throw invalidSelection(
        `Flair '${invalidFlairId}' is not active in channel '${channelUniqueName}'.`,
        channelUniqueName
      );
    }

    if (!flairIdsByChannel.has(channelUniqueName)) {
      flairIdsByChannel.set(channelUniqueName, []);
    }
  }

  return flairIdsByChannel;
};
