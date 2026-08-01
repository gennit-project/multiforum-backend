import { GraphQLError } from "graphql";
import type { Driver } from "neo4j-driver";
import { findChannelDiscussionFlairConfig } from "../../services/discussionFlairStore.js";

type Input = {
  driver: Driver;
};

type Args = {
  channelUniqueName: string;
  includeArchived?: boolean | null;
};

export const getChannelDiscussionFlairConfig = ({ driver }: Input) => {
  return async (
    _parent: unknown,
    { channelUniqueName, includeArchived = false }: Args
  ) => {
    const normalizedChannelName = channelUniqueName?.trim();
    if (!normalizedChannelName) {
      throw new GraphQLError("Channel unique name is required.");
    }

    const session = driver.session();
    try {
      const config = await findChannelDiscussionFlairConfig({
        executor: session,
        channelUniqueName: normalizedChannelName,
        includeArchived: includeArchived === true,
      });

      if (!config) {
        throw new GraphQLError("Channel not found.", {
          extensions: { code: "CHANNEL_NOT_FOUND" },
        });
      }

      return config;
    } finally {
      await session.close();
    }
  };
};

export default getChannelDiscussionFlairConfig;
