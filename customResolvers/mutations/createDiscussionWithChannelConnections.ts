import {createDiscussionCreationRepository, type DiscussionCreationRepository} from "../../services/persistence/discussionCreationRepository.js";
import type { Driver } from "neo4j-driver";
import type { GraphQLResolveInfo } from "graphql";
import { createDiscussionChannelQuery } from "../cypher/cypherQueries.js";
import { DiscussionCreateInput } from "../../src/generated/graphql.js";
import { triggerChannelPluginPipeline, triggerPluginRunsForDownloadableFile } from "../../services/pluginRunner.js";
import { GraphQLError } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { sanitizeAlbumCreateNode } from "./utils/ownershipSanitizers.js";
import type { GraphQLContext } from "../../types/context.js";
import { logger } from "../../logger.js";
import {
  loadChannelDiscussionFlairRequirements,
  validateDiscussionFlairSelections,
  type DiscussionChannelFlairSelectionInput,
} from "../../services/discussionFlairSubmission.js";

type DiscussionCreateInputWithChannels = {
  discussionCreateInput: DiscussionCreateInput;
  channelConnections: string[];
  channelFlairSelections?: DiscussionChannelFlairSelectionInput[] | null;
};

type Args = {
  input: DiscussionCreateInputWithChannels[];
};

type Input = {
  discussionCreationRepository?: DiscussionCreationRepository;
  driver: Driver;
};

export const triggerCreatedDownloadPipelines = async ({
  driver,
  discussionId,
  downloadableFileId,
  channelConnections,
  triggerDownload = triggerPluginRunsForDownloadableFile,
  triggerChannel = triggerChannelPluginPipeline,
}: {
  driver?: Driver;
  discussionId: string;
  downloadableFileId: string;
  channelConnections: string[];
  triggerDownload?: typeof triggerPluginRunsForDownloadableFile;
  triggerChannel?: typeof triggerChannelPluginPipeline;
}) => {
  try {
    await triggerDownload({
      driver,
      downloadableFileId,
      event: "downloadableFile.created",
    });
  } catch (triggerError: unknown) {
    const message = triggerError instanceof Error
      ? triggerError.message
      : String(triggerError);
    logger.error(
      `downloadableFile.created plugin trigger error for ${discussionId}:`,
      message
    );
  }

  for (const channelUniqueName of channelConnections) {
    try {
      await triggerChannel({
        driver,
        discussionId,
        channelUniqueName,
        event: 'discussionChannel.created',
      });
    } catch (pipelineError: unknown) {
      const message = pipelineError instanceof Error
        ? pipelineError.message
        : String(pipelineError);
      logger.error(`Channel pipeline error for ${channelUniqueName}:`, message);
    }
  }
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



/**
 * Function to create discussions from an input array.
 */
export const createDiscussionsFromInput = async (
  repository: DiscussionCreationRepository,
  driver: Driver,
  input: DiscussionCreateInputWithChannels[],
  context?: GraphQLContext
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

    sanitizedInput = input.map(
      ({
        discussionCreateInput,
        channelConnections,
        channelFlairSelections,
      }) => {
        const albumCreate = discussionCreateInput?.Album?.create;
        const albumCreateNode = albumCreate?.node;

        if (!albumCreateNode) {
          return {
            discussionCreateInput,
            channelConnections,
            channelFlairSelections,
          };
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
          channelFlairSelections,
        };
      }
    ) as DiscussionCreateInputWithChannels[];
  }

  const session = driver.session();
  const discussions: unknown[] = [];

  try {
    for (const { channelConnections } of sanitizedInput) {
      if (!channelConnections || channelConnections.length === 0) {
        throw new Error("At least one channel must be selected");
      }
    }

    const uniqueChannelNames = [
      ...new Set(
        sanitizedInput.flatMap(({ channelConnections }) => channelConnections)
      ),
    ];
    const requirementsByChannel =
      await loadChannelDiscussionFlairRequirements({
        executor: session,
        channelUniqueNames: uniqueChannelNames,
      });
    const flairIdsByInput = sanitizedInput.map(
      ({ channelConnections, channelFlairSelections }) =>
        validateDiscussionFlairSelections({
          channelConnections,
          channelFlairSelections,
          requirementsByChannel,
        })
    );

    for (const [inputIndex, { discussionCreateInput, channelConnections }] of
      sanitizedInput.entries()) {
      const response = await repository.createDiscussion(discussionCreateInput);

      const newDiscussion = response.discussions[0];
      const newDiscussionId = newDiscussion.id;

      // Check if this discussion has a download attached
      const hasDownload = discussionCreateInput.hasDownload === true;

      // Link the discussion to channels
      for (const channelUniqueName of channelConnections) {
        try {
          // A managed write, so the age-gate reconcile step runs before commit.
          await session.executeWrite((tx) =>
            tx.run(createDiscussionChannelQuery, {
              discussionId: newDiscussionId,
              channelUniqueName,
              upvotedBy: newDiscussion.Author?.username,
              flairIds: flairIdsByInput[inputIndex].get(channelUniqueName) ?? [],
            })
          );

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

      // Trigger the downloadable-file plugin pipeline (e.g. security scan) once
      // per created download, mirroring the channel pipeline trigger above.
      // Without this, plugins that handle downloadableFile.created never run on
      // upload.
      if (hasDownload) {
        try {
          const withFile = await repository.findAttachedFiles(newDiscussionId);
          const downloadableFileId = (
            withFile?.[0] as unknown as { DownloadableFiles?: Array<{ id?: string }> }
          )?.DownloadableFiles?.[0]?.id;
          if (downloadableFileId) {
            await triggerCreatedDownloadPipelines({
              driver,
              discussionId: newDiscussionId,
              downloadableFileId,
              channelConnections,
            });
          }
        } catch (triggerError: unknown) {
          const message =
            triggerError instanceof Error ? triggerError.message : String(triggerError);
          logger.error(
            `downloadableFile.created plugin trigger error for ${newDiscussionId}:`,
            message
          );
        }
      }

      // Refetch the discussion with all related data
      const fetchedDiscussion = await repository.findCreatedDiscussion(newDiscussionId);

      discussions.push(fetchedDiscussion[0]);
    }
  } catch (error: unknown) {
    logger.error("Error creating discussions:", error);
    if (error instanceof GraphQLError) {
      throw error;
    }
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
  const { driver } = input;

  const repository = input.discussionCreationRepository ?? createDiscussionCreationRepository(driver);

  return async (parent: unknown, args: Args, context: GraphQLContext, info: GraphQLResolveInfo) => {
    const { input } = args;

    try {
      // Use the extracted function to create discussions
      const discussions = await createDiscussionsFromInput(
        repository,
        driver,
        input,
        context
      );
      return discussions;
    } catch (error: unknown) {
      logger.error(error);
      if (error instanceof GraphQLError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`An error occurred while creating discussions: ${message}`);
    }
  };
};

export default getResolver;
