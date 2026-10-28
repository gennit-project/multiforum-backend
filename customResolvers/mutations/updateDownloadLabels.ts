import type { Driver } from "neo4j-driver";
import { createDownloadLabelRepository, type DownloadLabelRepository } from "../../services/persistence/downloadLabelRepository.js";

import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import {
  checkChannelModPermissions,
  ModChannelPermission,
} from "../../rules/permission/hasChannelModPermission.js";
import { getServerScopedMembership } from "../../rules/permission/getServerScopedMembership.js";
import { GraphQLError, type GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import { logger } from "../../logger.js";
import {
  assertValidUploadSelections,
  type SelectedLabel,
} from "./validateDownloadLabelSelections.js";

type Args = {
  discussionId: string;
  channelUniqueName: string;
  labelOptionIds: string[];
};

type Input = { driver: Driver; downloadLabelRepository?: DownloadLabelRepository };

const getResolver = (input: Input) => {
  const repository = input.downloadLabelRepository ?? createDownloadLabelRepository(input.driver);

  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const {
      discussionId,
      channelUniqueName,
      labelOptionIds,
    } = args;

    if (!discussionId) {
      throw new GraphQLError("Discussion ID is required");
    }

    if (!channelUniqueName) {
      throw new GraphQLError("Channel unique name is required");
    }

    // Set user data on context
    context.user = await setUserDataOnContext({
      context,
    });

    const loggedInUsername = context.user?.username || null;

    if (!loggedInUsername) {
      throw new GraphQLError("User must be logged in");
    }

    // Get the discussion to check ownership
    const discussionData = await repository.findDiscussion(discussionId);

    if (discussionData.length === 0) {
      throw new GraphQLError("Discussion not found");
    }

    const discussion = discussionData[0];
    const discussionAuthorUsername = discussion.Author?.username;
    const isOwner = discussionAuthorUsername === loggedInUsername;

    // Non-owners must be server admins or hold the shared channel-moderation
    // permission used by other edit flows.
    const loggedInModName = context.user?.data?.ModerationProfile?.displayName;
    let hasModPermission = false;

    if (!isOwner) {
      const membership = await getServerScopedMembership(context);
      if (membership.isServerAdmin) {
        hasModPermission = true;
      } else {
        const permissionResult = await checkChannelModPermissions({
          channelConnections: [channelUniqueName],
          context,
          permissionCheck: ModChannelPermission.canEditDiscussions,
        });

        if (permissionResult instanceof Error) {
          throw new GraphQLError(permissionResult.message);
        }

        if (permissionResult !== true) {
          throw new GraphQLError("You don't have permission to update labels on this download");
        }

        hasModPermission = true;
      }
    }

    // Find the DiscussionChannel
    const discussionChannelData = await repository.findChannel(discussionId, channelUniqueName);

    if (discussionChannelData.length === 0) {
      throw new GraphQLError("DiscussionChannel not found");
    }

    const discussionChannel = discussionChannelData[0];
    const discussionChannelId = discussionChannel.id;
    const existingLabelIds = discussionChannel.LabelOptions?.map((l: { id: string }) => l.id) || [];

    let selectedLabels: SelectedLabel[] = [];
    if (labelOptionIds.length > 0) {
      selectedLabels = await repository.findOptions(labelOptionIds) as SelectedLabel[];
      assertValidUploadSelections(selectedLabels);
    }

    // Calculate which labels to connect and disconnect
    const labelsToConnect = labelOptionIds.filter((id: string) => !existingLabelIds.includes(id));
    const labelsToDisconnect = existingLabelIds.filter((id: string) => !labelOptionIds.includes(id));

    // Get label details for labels being added
    let addedLabels: Array<{ id: string; displayName: string; value: string }> = [];
    if (labelsToConnect.length > 0) {
      addedLabels = selectedLabels
        .filter((label) => labelsToConnect.includes(label.id))
        .map((l) => ({
          id: l.id,
          displayName: l.displayName || l.value,
          value: l.value,
        }));
    }

    // Get label details for labels being removed
    let removedLabels: Array<{ id: string; displayName: string; value: string }> = [];
    if (labelsToDisconnect.length > 0) {
      // Get details from existing labels on the discussion channel
      removedLabels = (discussionChannel.LabelOptions || [])
        .filter((l: { id: string }) => labelsToDisconnect.includes(l.id))
        .map((l: { id: string; displayName?: string | null; value: string }) => ({
          id: l.id,
          displayName: l.displayName || l.value,
          value: l.value,
        }));
    }

    // Get label names for the moderation action description (all final labels)
    const labelNames = selectedLabels.map((label) => label.displayName || label.value);

    // Build the update operation
    const updateInput: any = {
      LabelOptions: [],
    };

    if (labelsToConnect.length > 0) {
      updateInput.LabelOptions.push({
        connect: labelsToConnect.map((id: string) => ({
          where: { node: { id: { eq: id } } },
        })),
      });
    }

    if (labelsToDisconnect.length > 0) {
      updateInput.LabelOptions.push({
        disconnect: labelsToDisconnect.map((id: string) => ({
          where: { node: { id: { eq: id } } },
        })),
      });
    }

    // Apply the update
    const updateResult = await repository.updateLabels(discussionChannelId, updateInput.LabelOptions.length > 0 ? { LabelOptions: updateInput.LabelOptions } : {});

    const updatedDiscussionChannel = updateResult.discussionChannels[0];

    // Create LabelChangeHistory records for all label changes
    // This tracks the activity feed visible on the download detail page
    try {
      // Create records for added labels
      for (const label of addedLabels) {
        const historyInput: any = {
          actionType: "added",
          labelDisplayName: label.displayName,
          labelValue: label.value,
          DiscussionChannel: {
            connect: {
              where: {
                node: { id: discussionChannelId },
              },
            },
          },
        };

        // Connect to the appropriate actor
        if (!isOwner && hasModPermission && loggedInModName) {
          historyInput.ActorMod = {
            connect: {
              where: {
                node: { displayName: loggedInModName },
              },
            },
          };
        } else {
          historyInput.ActorUser = {
            connect: {
              where: {
                node: { username: loggedInUsername },
              },
            },
          };
        }

        await repository.createHistory([historyInput]);
      }

      // Create records for removed labels
      for (const label of removedLabels) {
        const historyInput: any = {
          actionType: "removed",
          labelDisplayName: label.displayName,
          labelValue: label.value,
          DiscussionChannel: {
            connect: {
              where: {
                node: { id: discussionChannelId },
              },
            },
          },
        };

        // Connect to the appropriate actor
        if (!isOwner && hasModPermission && loggedInModName) {
          historyInput.ActorMod = {
            connect: {
              where: {
                node: { displayName: loggedInModName },
              },
            },
          };
        } else {
          historyInput.ActorUser = {
            connect: {
              where: {
                node: { username: loggedInUsername },
              },
            },
          };
        }

        await repository.createHistory([historyInput]);
      }
    } catch (error) {
      logger.error("Error creating label change history:", error);
      // Don't fail the label update if history creation fails
    }

    // If the user is not the owner (i.e., is a mod), create a moderation action record
    if (!isOwner && hasModPermission && loggedInModName) {
      const actionDescription = labelNames.length > 0
        ? `Updated download labels to: ${labelNames.join(", ")} on "${discussion.title || 'untitled'}"`
        : `Removed all download labels from "${discussion.title || 'untitled'}"`;

      const moderationActionInput: Record<string, unknown> = {
        actionType: "label_update",
        actionDescription,
        ModerationProfile: {
          connect: {
            where: {
              node: {
                displayName: loggedInModName,
              },
            },
          },
        },
      };

      try {
        await repository.createModerationAction([moderationActionInput]);
      } catch (error) {
        logger.error("Error creating moderation action:", error);
        // Don't fail the label update if moderation action creation fails
      }
    }

    return updatedDiscussionChannel;
  };
};

export default getResolver;
