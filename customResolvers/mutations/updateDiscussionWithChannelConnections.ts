import {createDiscussionUpdateRepository, type DiscussionUpdateRepository} from "../../services/persistence/discussionUpdateRepository.js";
import type { Driver } from "neo4j-driver";
import { updateDiscussionChannelQuery, severConnectionBetweenDiscussionAndChannelQuery } from "../cypher/cypherQueries.js";
import { DiscussionWhere, DiscussionUpdateInput } from "../../src/generated/graphql.js";
import { discussionVersionHistoryHandler } from "../../hooks/discussionVersionHistoryHook.js";
import { GraphQLError, type GraphQLResolveInfo } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import {
  writeDiscussionAlbum,
  albumImageScalars,
  type DiscussionAlbumWrite,
} from "../../services/persistence/discussionAlbumWrite.js";
import type { GraphQLContext } from "../../types/context.js";
import { triggerPluginRunsForDownloadableFile } from "../../services/pluginRunner.js";
import { executeManagedWrite } from "../../services/neo4jTransactions.js";
import { stripTags, ownTags } from "../../services/persistence/tagOwnership.js";
import { logger } from "../../logger.js";
import {
  loadChannelDiscussionFlairRequirements,
  validateDiscussionFlairSelections,
  type DiscussionChannelFlairSelectionInput,
} from "../../services/discussionFlairSubmission.js";

type Input = {
  discussionUpdateRepository?: DiscussionUpdateRepository;
  driver: Driver;
};

type Args = {
  where: DiscussionWhere;
  discussionUpdateInput: DiscussionUpdateInput;
  channelConnections?: string[];
  channelDisconnections?: string[];
  albumImageDisconnections?: string[];
  channelFlairSelections?: DiscussionChannelFlairSelectionInput[] | null;
};

const stampAttachedDownloadableFilesQuery = `
  MATCH (file:DownloadableFile)
  WHERE file.id IN $ids
  SET file.ageGateTouchedAt = datetime()
`;

const disconnectAlbumImagesQuery = `
  MATCH (:Discussion { id: $discussionId })-[:HAS_ALBUM]->(album:Album)
  OPTIONAL MATCH (album)-[relationship:HAS_IMAGE]->(image:Image)
  WHERE image.id IN $imageIds
  WITH album, collect(relationship) AS relationships
  FOREACH (relationship IN relationships | DELETE relationship)
  SET album.imageOrder = [
    imageId IN coalesce(album.imageOrder, [])
    WHERE NOT imageId IN $imageIds
  ]
`;

export const getConnectedDownloadableFileIds = (
  updateInput: DiscussionUpdateInput
): string[] => {
  const updates = updateInput.DownloadableFiles || [];
  return updates.flatMap((update) =>
    (update?.connect || [])
      .map((connection) => connection?.where?.node?.id?.eq)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );
};

const getResolver = (
  input: Input,
  triggerDownloadRuns: typeof triggerPluginRunsForDownloadableFile =
    triggerPluginRunsForDownloadableFile
) => {
  const { driver } = input;
  const repository = input.discussionUpdateRepository ?? createDiscussionUpdateRepository(driver);
  return async (parent: unknown, args: Args, context: GraphQLContext, info: GraphQLResolveInfo) => {
    const {
      where,
      discussionUpdateInput,
      channelConnections = [],
      channelDisconnections = [],
      albumImageDisconnections = [],
      channelFlairSelections = [],
    } = args;
    const normalizedChannelFlairSelections = channelFlairSelections ?? [];
    const normalizedAlbumImageDisconnections = [
      ...new Set(
        albumImageDisconnections.filter(
          (imageId) => typeof imageId === "string" && imageId.length > 0
        )
      ),
    ];

    // v7's DiscussionUpdateInput no longer carries the Album relationship, so read
    // it from a loose view, strip it from the generated update, and apply it as an
    // owned album write (see discussionAlbumWrite).
    const albumInput = (discussionUpdateInput as Record<string, any>)?.Album;
    const albumCreateNode = albumInput?.create?.node;
    const albumUpdateNode = albumInput?.update?.node;
    const albumNode = albumCreateNode ?? albumUpdateNode;

    let albumWrite: DiscussionAlbumWrite | null = null;
    if (albumNode) {
      context.user = await setUserDataOnContext({
        context,
      });

      const username = context.user?.username;

      if (!username) {
        throw new GraphQLError("You must be logged in to update albums.");
      }

      albumWrite = {
        discussionId: where.id?.eq ?? "",
        username,
        mode: albumCreateNode ? "create" : "update",
        imageOrder: albumNode.imageOrder,
        images: albumImageScalars(albumNode.Images),
      };
    }

    const { Album: _strippedAlbum, ...withoutAlbum } =
      discussionUpdateInput as Record<string, any>;
    void _strippedAlbum;
    // v7 dropped connectOrCreate for Tags; strip the Tags field and own the
    // HAS_TAG edges (replace semantics) so the discussion's tags match the set.
    const { cleaned: withoutAlbumOrTags, tagTexts, hadTags } = stripTags(withoutAlbum);
    const sanitizedUpdateInput = withoutAlbumOrTags as DiscussionUpdateInput;

    let flairIdsByChannel = new Map<string, string[]>();
    if (
      channelConnections.length > 0 ||
      normalizedChannelFlairSelections.length > 0
    ) {
      const flairValidationSession = driver.session();
      try {
        const requirementsByChannel =
          await loadChannelDiscussionFlairRequirements({
            executor: flairValidationSession,
            channelUniqueNames: [...new Set(channelConnections)],
          });
        flairIdsByChannel = validateDiscussionFlairSelections({
          channelConnections,
          channelFlairSelections: normalizedChannelFlairSelections,
          requirementsByChannel,
        });
      } finally {
        await flairValidationSession.close();
      }
    }
    
    try {
      const shouldTrackVersion =
        sanitizedUpdateInput.title !== undefined ||
        sanitizedUpdateInput.body !== undefined;
      const discussionSnapshot = shouldTrackVersion
        ? (await repository.findRevisionSnapshot(where))[0]
        : null;
      
      const connectedDownloadableFileIds = getConnectedDownloadableFileIds(
        sanitizedUpdateInput
      );
      const updatedDiscussionId = where.id?.eq;

      // Update the discussion in a managed write so the age-gate reconcile step
      // runs before commit. Attaching an existing file is a relationship-only
      // connect, which @neo4j/graphql doesn't stamp, so stamp the attached files
      // here: the reconcile step then flags them in this same transaction.
      await executeManagedWrite(driver, async (tx) => {
        await repository.updateWithinTransaction(where, sanitizedUpdateInput, tx);
        if (hadTags && updatedDiscussionId) {
          await ownTags(
            (cypher, params) => tx.run(cypher, params),
            { label: "Discussion", id: updatedDiscussionId },
            tagTexts,
            { replace: true }
          );
        }
        if (albumWrite) {
          await writeDiscussionAlbum(tx, albumWrite);
        }
        if (connectedDownloadableFileIds.length > 0) {
          await tx.run(stampAttachedDownloadableFilesQuery, {
            ids: connectedDownloadableFileIds,
          });
        }
        if (normalizedAlbumImageDisconnections.length > 0) {
          await tx.run(disconnectAlbumImagesQuery, {
            discussionId: where.id,
            imageIds: normalizedAlbumImageDisconnections,
          });
        }

        for (const channelUniqueName of channelConnections) {
          const flairSelectionProvided = normalizedChannelFlairSelections.some(
            (selection) =>
              selection.channelUniqueName.trim() === channelUniqueName
          );
          await tx.run(updateDiscussionChannelQuery, {
            discussionId: updatedDiscussionId,
            channelUniqueName,
            flairIds: flairIdsByChannel.get(channelUniqueName) ?? [],
            flairSelectionProvided,
          });
        }

        for (const channelUniqueName of channelDisconnections) {
          await tx.run(severConnectionBetweenDiscussionAndChannelQuery, {
            discussionId: updatedDiscussionId,
            channelUniqueName,
          });
        }
      });

      if (shouldTrackVersion) {
        await discussionVersionHistoryHandler({
          context,
          params: {
            where: { id: where.id?.eq },
            update: {
              title: sanitizedUpdateInput.title?.set,
              body: sanitizedUpdateInput.body?.set,
            },
          },
          discussionSnapshot,
        });
      }

      // The edit form uploads replacement files before connecting them to the
      // discussion. Trigger only newly connected file IDs after Discussion.update
      // has created that relationship, so the scanner receives discussion and
      // channel context and the replacement cannot remain PENDING indefinitely.
      for (const downloadableFileId of connectedDownloadableFileIds) {
        try {
          await triggerDownloadRuns({
            driver,
            downloadableFileId,
            event: "downloadableFile.updated",
          });
        } catch (triggerError: unknown) {
          const message = triggerError instanceof Error
            ? triggerError.message
            : String(triggerError);
          logger.error(
            `downloadableFile.updated plugin trigger error for ${downloadableFileId}:`,
            message
          );
        }
      }

      // Refetch the newly created discussion with the channel connections
      // and disconnections so that we can return it.


      const result = await repository.findUpdatedDiscussion(updatedDiscussionId);
      return result[0];
    } catch (error: unknown) {
      logger.error("Error updating discussion:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to update discussion. ${message}`);
    }
  };
};
export default getResolver;
