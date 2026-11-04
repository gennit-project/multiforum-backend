import { reconcileAgeGateBeforeRead } from "../../services/ageGate/reconcile.js";
import { createExistingDiscussionCrosspost } from "../../services/persistence/crosspostWrite.js";
import { mayAccessSensitiveContent } from "../../services/sensitiveContentAccess.js";
import { createInstancePolicyRepository } from "../../services/persistence/instancePolicyRepository.js";
import {createDiscussionCreationRepository, type DiscussionCreationRepository} from "../../services/persistence/discussionCreationRepository.js";
import type { Driver } from "neo4j-driver";
import type { GraphQLResolveInfo } from "graphql";
import { createDiscussionChannelQuery } from "../cypher/cypherQueries.js";
import { DiscussionCreateInput } from "../../src/generated/graphql.js";
import { triggerChannelPluginPipeline, triggerPluginRunsForDownloadableFile } from "../../services/pluginRunner.js";
import { GraphQLError } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import {
  connectCreatedDiscussionAlbumOwnership,
  connectDiscussionAuthorAndCollection,
  stripDiscussionToOneConnects,
} from "../../services/persistence/discussionAlbumWrite.js";
import { stripTags, ownTags } from "../../services/persistence/tagOwnership.js";
import type { GraphQLContext } from "../../types/context.js";

// v7 removed the nested to-one connect, so the generated createDiscussions can
// create the nested Album + its Images but not attach their Owner/Uploader. Strip
// those connects before the generated create; the owned post-create write wires
// the ownership edges (see discussionAlbumWrite).
const stripAlbumOwnerConnects = (node: unknown): unknown => {
  if (!node || typeof node !== "object") return node;
  const { Owner, Images, ...rest } = node as Record<string, any>;
  void Owner;
  const out: Record<string, unknown> = { ...rest };
  if (Images) out.Images = Images;
  if (Images && Images.create) {
    const entries = Array.isArray(Images.create) ? Images.create : [Images.create];
    out.Images = {
      ...Images,
      create: entries.map((entry: any) => {
        if (!entry || !entry.node) return entry;
        const { Uploader, ...restNode } = entry.node as Record<string, unknown>;
        void Uploader;
        return { ...entry, node: restNode };
      }),
    };
  }
  return out;
};
import { logger } from "../../logger.js";
import {
  loadChannelDiscussionFlairRequirements,
  validateDiscussionFlairSelections,
  type DiscussionChannelFlairSelectionInput,
} from "../../services/discussionFlairSubmission.js";

type DiscussionCreateInputWithChannels = {
  discussionCreateInput: DiscussionCreateInput;
  crosspostedDiscussionId?: string | null;
  channelConnections: string[];
  channelFlairSelections?: DiscussionChannelFlairSelectionInput[] | null;
};

type Args = {
  input: DiscussionCreateInputWithChannels[];
};

type Input = {
  discussionCreationRepository?: DiscussionCreationRepository;
  driver: Driver;
  triggerPipelines?: typeof triggerCreatedDiscussionPipelines;
};

export const triggerCreatedDiscussionPipelines = async ({
  driver,
  discussionId,
  downloadableFileIds = [],
  channelConnections,
  triggerDownload = triggerPluginRunsForDownloadableFile,
  triggerChannel = triggerChannelPluginPipeline,
}: {
  driver?: Driver;
  discussionId: string;
  downloadableFileIds?: string[];
  channelConnections: string[];
  triggerDownload?: typeof triggerPluginRunsForDownloadableFile;
  triggerChannel?: typeof triggerChannelPluginPipeline;
}) => {
  for (const downloadableFileId of new Set(downloadableFileIds)) {
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
  }

  for (const channelUniqueName of channelConnections) {
    // Fire-and-forget: execute moderation without blocking discussion creation.
    // Deferred runs are never picked up (no worker/cron; frontend only triggers
    // download pipelines), so run it non-blocking. Durable queue tracked separately.
    void triggerChannel(
      {
        driver,
        discussionId,
        channelUniqueName,
        event: 'discussionChannel.created',
      },
      { execution: { deferExecution: false } }
    ).catch((pipelineError: unknown) => {
      const message = pipelineError instanceof Error
        ? pipelineError.message
        : String(pipelineError);
      logger.error(`Channel pipeline error for ${channelUniqueName}:`, message);
    });
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
  context?: GraphQLContext,
  triggerPipelines = triggerCreatedDiscussionPipelines
): Promise<unknown[]> => {
  if (!input || input.length === 0) {
    throw new Error("Input cannot be empty");
  }

  let sanitizedInput = input;
  let albumOwnerUsername: string | undefined;

  // v7 removed the Author to-one connect; the author is the authenticated user,
  // resolved from context (the client can no longer name it on the input).
  if (context && !context.user) {
    context.user = await setUserDataOnContext({ context });
  }
  const contextUsername = context?.user?.username;

  // Connections must name an exact existing image so ownership can distinguish
  // newly created nodes from reused ones, including images without an uploader.
  for (const item of input) {
    if (item.crosspostedDiscussionId != null && !item.crosspostedDiscussionId.trim()) {
      throw new GraphQLError("Crossposted discussion ID cannot be empty.");
    }
    for (const connection of item.discussionCreateInput.Album?.create?.node?.Images?.connect ?? []) {
      const filter = connection.where?.node;
      if (!filter?.id?.eq || Object.keys(filter).length !== 1 || Object.keys(filter.id).length !== 1) {
        throw new GraphQLError("Album image connections require one exact image ID.");
      }
    }
  }
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
    albumOwnerUsername = username;

    sanitizedInput = input.map(
      ({
        discussionCreateInput,
        crosspostedDiscussionId,
        channelConnections,
        channelFlairSelections,
      }) => {
        const albumCreate = discussionCreateInput?.Album?.create;
        const albumCreateNode = albumCreate?.node;

        if (!albumCreateNode) {
          return {
            discussionCreateInput,
            crosspostedDiscussionId,
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
                node: stripAlbumOwnerConnects(albumCreateNode),
              },
            },
          },
          crosspostedDiscussionId,
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

    for (const [inputIndex, { discussionCreateInput, channelConnections, crosspostedDiscussionId }] of
      sanitizedInput.entries()) {
      if (crosspostedDiscussionId) {
        if (!contextUsername || !context) throw new GraphQLError("Authentication required.");
        const sensitive = await mayAccessSensitiveContent({context,driver,agePolicyRepository:createInstancePolicyRepository(driver)});
        const { created, downloadableFileIds } = await createExistingDiscussionCrosspost(driver,discussionCreateInput,crosspostedDiscussionId,contextUsername,
          channelConnections,flairIdsByInput[inputIndex],sensitive);
        discussions.push(created);
        const createdId = (created as {id:string}).id;
        await triggerPipelines({driver,discussionId:createdId,channelConnections,downloadableFileIds});
        continue;
      }
      // v7 removed the to-one connect, so strip the Author (POSTED_DISCUSSION)
      // every create sets and the SharedCollection (SHARES_COLLECTION) a shared
      // collection sets; the generated create makes the node, the owned write
      // wires those edges.
      const { cleaned, authorUsername, sharedCollectionId } =
        stripDiscussionToOneConnects(discussionCreateInput);
      // v7 dropped connectOrCreate for Tags; strip the Tags field and own the
      // HAS_TAG edges (create-if-missing) after the generated create.
      const { cleaned: cleanedNoTags, tagTexts } = stripTags(cleaned as Record<string, any>);
      const resolvedAuthor = authorUsername ?? contextUsername ?? null;
      const { newDiscussionId, createdChannelConnections, createdDiscussion, downloadableFileIds } = await session.executeWrite(async (tx) => {
        const response = await repository.createDiscussion(
          cleanedNoTags as DiscussionCreateInput,
          tx
        );
        const newDiscussionId = response.discussions[0]?.id;
        if (!newDiscussionId) {
          throw new Error("Discussion creation returned no discussion");
        }

        await connectDiscussionAuthorAndCollection(driver, {
          discussionId: newDiscussionId,
          authorUsername: resolvedAuthor,
          sharedCollectionId,
        }, tx);
        await ownTags((cypher, params) => tx.run(cypher, params),
          { label: "Discussion", id: newDiscussionId }, tagTexts);
        if (albumOwnerUsername && discussionCreateInput?.Album?.create?.node) {
          await connectCreatedDiscussionAlbumOwnership(driver, {
            discussionId: newDiscussionId,
            username: albumOwnerUsername,
            reusedImageIds: discussionCreateInput.Album.create.node.Images?.connect?.flatMap(c => c.where?.node?.id?.eq ? [c.where.node.id.eq] : []) ?? [],
          }, tx);
        }
        if (sharedCollectionId) {
          const linked = await tx.run(
            `MATCH (:Discussion {id: $id})-[:SHARES_COLLECTION]->(collection:Collection {id: $collectionId})
             RETURN collection.id`,
            { id: newDiscussionId, collectionId: sharedCollectionId }
          );
          if (linked.records.length !== 1) {
            throw new GraphQLError("Shared collection is no longer available.");
          }
        }
        const createdChannelConnections: string[] = [];
        for (const channelUniqueName of channelConnections) {
          const result = await tx.run(createDiscussionChannelQuery, {
            discussionId: newDiscussionId,
            channelUniqueName,
            upvotedBy: resolvedAuthor,
            flairIds: flairIdsByInput[inputIndex].get(channelUniqueName) ?? [],
          });
          if (result.records.length !== 1) {
            throw new GraphQLError("Could not connect the discussion to the selected forum.");
          }
          createdChannelConnections.push(channelUniqueName);
        }
        // Validate the existing fixed projection while failures can still roll
        // back this item. Keep the repository's existing authorization context.
        const projected = await repository.findCreatedDiscussion(newDiscussionId, tx);
        if (projected.length !== 1 || !projected[0] || projected[0].id !== newDiscussionId) {
          throw new GraphQLError("Created discussion is unavailable for the response.");
        }
        let downloadableFileIds: string[] = [];
        if (discussionCreateInput.hasDownload === true) {
          // Keep the former post-commit read's materialized visibility and empty
          // JWT, but let a lookup error roll back this item's owned writes.
          await reconcileAgeGateBeforeRead(driver, tx);
          const withFiles = await repository.findAttachedFiles(newDiscussionId, tx);
          downloadableFileIds = withFiles[0]?.DownloadableFiles.map(file => file.id) ?? [];
        }
        return { newDiscussionId, createdChannelConnections, createdDiscussion: projected[0], downloadableFileIds };
      });
      // Plugin work is deliberately outside the retryable transaction. Failure
      // here cannot roll back the item and does not imply durable delivery.
      // Every successful DiscussionChannel creation emits its own channel event,
      // including ordinary text discussions. Downloads additionally emit the
      // file event for every eligible attachment before the channel events.
      await triggerPipelines({
        driver,
        discussionId: newDiscussionId,
        downloadableFileIds,
        channelConnections: createdChannelConnections,
      });

      // Return the creation snapshot, independent of subsequent plugin writes.
      // Outer GraphQL completion and network delivery still happen after commit.
      discussions.push(createdDiscussion);
    }
  } catch (error: unknown) {
    logger.error("Error creating discussions:", error);
    if (error instanceof GraphQLError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create discussions: ${message}`);
  } finally {
    await session.close();
  }

  return discussions;
};

/**
 * Main resolver that uses createDiscussionsFromInput
 */
const getResolver = (input: Input) => {
  const { driver, triggerPipelines } = input;

  const repository = input.discussionCreationRepository ?? createDiscussionCreationRepository(driver);

  return async (parent: unknown, args: Args, context: GraphQLContext, info: GraphQLResolveInfo) => {
    const { input } = args;

    try {
      // Use the extracted function to create discussions
      const discussions = await createDiscussionsFromInput(
        repository,
        driver,
        input,
        context,
        triggerPipelines
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
