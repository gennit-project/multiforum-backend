import type { Driver } from "neo4j-driver";
import type { GraphQLResolveInfo } from "graphql";
import { createDiscussionChannelQuery } from "../cypher/cypherQueries.js";
import { DiscussionCreateInput } from "../../src/generated/graphql";
import { triggerChannelPluginPipeline } from "../../services/pluginRunner.js";
import { GraphQLError } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { sanitizeAlbumCreateNode } from "./utils/ownershipSanitizers.js";
import type { GraphQLContext } from "../../types/context.js";
import { logger } from "../../logger.js";
import type {
  DiscussionModel,
  ChannelModel,
  DownloadableFileModel,
  PluginRunModel,
  ServerConfigModel,
  ServerSecretModel,
} from "../../ogm_types.js";

type DiscussionCreateInputWithChannels = {
  discussionCreateInput: DiscussionCreateInput;
  channelConnections: string[];
};

type Args = {
  input: DiscussionCreateInputWithChannels[];
};

type Input = {
  Discussion: DiscussionModel;
  driver: Driver;
  // Additional models for plugin pipeline support
  Channel?: ChannelModel;
  DownloadableFile?: DownloadableFileModel;
  PluginRun?: PluginRunModel;
  ServerConfig?: ServerConfigModel;
  ServerSecret?: ServerSecretModel;
};

// The reason why we cannot use the auto-generated resolver
// to create a Discussion with DiscussionChannels already linked
// is because the creation of the DiscussionChannel nodes
// requires a discussion ID.

// We do not have the discussion ID until the Discussion is created.
// And the discussion ID is required to create the DiscussionChannel nodes.
// in order to enforce a uniqueness constraint between one discussion
// and one channel.
// The reason why we have to create DiscussionChannel nodes
// with a discussion ID, channel uniqueName, and separate relationships
// to the Channel and Discussion nodes is because we cannot enforce
// a uniqueness constraint based on relationships alone. That constraint
// requires the IDs.

// Therefore, we have to create the Discussion first, then create the
// DiscussionChannel nodes that are linked to the Discussion and Channel nodes.

const selectionSet = `
  {
    id
    title
    body
    Author {
      username
    }
    DiscussionChannels {
      id
      createdAt
      channelUniqueName
      discussionId
      archived
      Channel {
        uniqueName
      }
      Discussion {
        id
      }
      UpvotedByUsers {
        username
      }
      UpvotedByUsersAggregate {
        count
      }
    }
    createdAt
    updatedAt
    Tags {
      text
    }
  }
`;

/**
 * Function to create discussions from an input array.
 */
export const createDiscussionsFromInput = async (
  Discussion: DiscussionModel,
  driver: Driver,
  input: DiscussionCreateInputWithChannels[],
  context?: GraphQLContext,
  pluginModels?: {
    Channel: ChannelModel;
    DownloadableFile: DownloadableFileModel;
    PluginRun: PluginRunModel;
    ServerConfig: ServerConfigModel;
    ServerSecret: ServerSecretModel;
  }
): Promise<unknown[]> => {
  if (!input || input.length === 0) {
    throw new Error("Input cannot be empty");
  }

  let sanitizedInput = input;

  const hasAlbumCreate = input.some(
    ({ discussionCreateInput }) =>
      discussionCreateInput?.Album?.create?.node
  );

  if (hasAlbumCreate) {
    if (!context) {
      throw new GraphQLError("Context is required for album creation.");
    }

    context.user = await setUserDataOnContext({
      context,
    });

    const username = context.user?.username;

    if (!username) {
      throw new GraphQLError("You must be logged in to create albums.");
    }

    sanitizedInput = input.map(({ discussionCreateInput, channelConnections }) => {
      const albumCreate = discussionCreateInput?.Album?.create;
      const albumCreateNode = albumCreate?.node;

      if (!albumCreateNode) {
        return { discussionCreateInput, channelConnections };
      }

      return {
        discussionCreateInput: {
          ...discussionCreateInput,
          Album: {
            ...discussionCreateInput?.Album,
            create: {
              ...(albumCreate ?? {}),
              node: sanitizeAlbumCreateNode(albumCreateNode, username),
            },
          },
        },
        channelConnections,
      };
    }) as DiscussionCreateInputWithChannels[];
  }

  const session = driver.session();
  const discussions: unknown[] = [];

  try {
    for (const { discussionCreateInput, channelConnections } of sanitizedInput) {
      if (!channelConnections || channelConnections.length === 0) {
        throw new Error("At least one channel must be selected");
      }

      const response = await Discussion.create({
        input: [discussionCreateInput],
        selectionSet: `{ discussions ${selectionSet} }`,
      });

      const newDiscussion = response.discussions[0];
      const newDiscussionId = newDiscussion.id;

      // Check if this discussion has a download attached
      const hasDownload = discussionCreateInput.hasDownload === true;

      // Link the discussion to channels
      for (const channelUniqueName of channelConnections) {
        try {
          await session.run(createDiscussionChannelQuery, {
            discussionId: newDiscussionId,
            channelUniqueName,
            upvotedBy: newDiscussion.Author?.username,
          });

          // Trigger channel plugin pipeline if discussion has a download
          // and plugin models are available
          if (hasDownload && pluginModels) {
            try {
              await triggerChannelPluginPipeline({
                discussionId: newDiscussionId,
                channelUniqueName,
                event: 'discussionChannel.created',
                models: {
                  Channel: pluginModels.Channel,
                  Discussion,
                  DownloadableFile: pluginModels.DownloadableFile,
                  Plugin: null as any, // Not used in channel pipeline
                  PluginVersion: null as any, // Not used directly
                  PluginRun: pluginModels.PluginRun,
                  ServerConfig: pluginModels.ServerConfig,
                  ServerSecret: pluginModels.ServerSecret,
                }
              });
            } catch (pipelineError: unknown) {
              // Log pipeline errors but don't fail the discussion creation
              const message = pipelineError instanceof Error ? pipelineError.message : String(pipelineError);
              logger.error(`Channel pipeline error for ${channelUniqueName}:`, message);
            }
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes("Constraint validation failed")) {
            logger.warn(`Skipping duplicate DiscussionChannel: ${channelUniqueName}`);
            continue;
          } else {
            throw error;
          }
        }
      }

      // Refetch the discussion with all related data
      const fetchedDiscussion = await Discussion.find({
        where: {
          id: newDiscussionId,
        },
        selectionSet,
      });

      discussions.push(fetchedDiscussion[0]);
    }
  } catch (error: unknown) {
    logger.error("Error creating discussions:", error);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create discussions: ${message}`);
  } finally {
    session.close();
  }

  return discussions;
};

/**
 * Main resolver that uses createDiscussionsFromInput
 */
const getResolver = (input: Input) => {
  const { Discussion, driver, Channel, DownloadableFile, PluginRun, ServerConfig, ServerSecret } = input;

  // Build plugin models object if all required models are provided
  const pluginModels = Channel && DownloadableFile && PluginRun && ServerConfig && ServerSecret
    ? { Channel, DownloadableFile, PluginRun, ServerConfig, ServerSecret }
    : undefined;

  return async (parent: unknown, args: Args, context: GraphQLContext, info: GraphQLResolveInfo) => {
    const { input } = args;

    try {
      // Use the extracted function to create discussions
      const discussions = await createDiscussionsFromInput(
        Discussion,
        driver,
        input,
        context,
        pluginModels
      );
      return discussions;
    } catch (error: unknown) {
      logger.error(error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`An error occurred while creating discussions: ${message}`);
    }
  };
};

export default getResolver;
