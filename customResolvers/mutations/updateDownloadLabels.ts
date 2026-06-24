import type {
  DiscussionModel,
  DiscussionChannelModel,
  FilterOptionModel,
  ModerationActionModel,
  ModerationActionCreateInput,
} from "../../ogm_types.js";

// LabelChangeHistory model type - defined locally until OGM types are regenerated
type LabelChangeHistoryModel = {
  create: (args: { input: any[] }) => Promise<any>;
  find: (args: any) => Promise<any[]>;
};
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError, type GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";

type Args = {
  discussionId: string;
  channelUniqueName: string;
  labelOptionIds: string[];
};

type Input = {
  Discussion: DiscussionModel;
  DiscussionChannel: DiscussionChannelModel;
  FilterOption: FilterOptionModel;
  ModerationAction: ModerationActionModel;
  LabelChangeHistory: LabelChangeHistoryModel;
};

const getResolver = (input: Input) => {
  const { Discussion, DiscussionChannel, FilterOption, ModerationAction, LabelChangeHistory } = input;

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
      getPermissionInfo: true,
    });

    const loggedInUsername = context.user?.username || null;

    if (!loggedInUsername) {
      throw new GraphQLError("User must be logged in");
    }

    // Get the discussion to check ownership
    const discussionData = await Discussion.find({
      where: {
        id: discussionId,
      },
      selectionSet: `{
        id
        title
        Author {
          username
        }
      }`,
    });

    if (discussionData.length === 0) {
      throw new GraphQLError("Discussion not found");
    }

    const discussion = discussionData[0];
    const discussionAuthorUsername = discussion.Author?.username;
    const isOwner = discussionAuthorUsername === loggedInUsername;

    // Check if user is a channel mod (if not the owner)
    const loggedInModName = context.user?.data?.ModerationProfile?.displayName;
    let hasModPermission = false;

    if (!isOwner) {
      // Check if user is a channel admin
      const isChannelAdmin = context.user?.data?.ModeratedChannels?.some(
        (c: { uniqueName: string }) => c.uniqueName === channelUniqueName
      );

      // Check if user is a server admin
      const isServerAdmin = context.user?.data?.AdminOfServers?.length > 0;

      // Check if mod has canEditDiscussions permission for the channel
      const channelModPermissions = context.user?.data?.ModerationProfile?.ModChannelRoles?.filter(
        (role: { channelUniqueName: string }) => role.channelUniqueName === channelUniqueName
      ) || [];

      const hasChannelModEditPermission = channelModPermissions.some(
        (role: { canEditDiscussions?: boolean }) => role.canEditDiscussions === true
      );

      // Check if mod has server-level canEditDiscussions permission
      const serverModPermissions = context.user?.data?.ModerationProfile?.ModServerRoles || [];
      const hasServerModEditPermission = serverModPermissions.some(
        (role: { canEditDiscussions?: boolean }) => role.canEditDiscussions === true
      );

      hasModPermission = isChannelAdmin || isServerAdmin || hasChannelModEditPermission || hasServerModEditPermission;

      if (!hasModPermission) {
        throw new GraphQLError("You don't have permission to update labels on this download");
      }
    }

    // Find the DiscussionChannel
    const discussionChannelData = await DiscussionChannel.find({
      where: {
        discussionId: discussionId,
        channelUniqueName: channelUniqueName,
      },
      selectionSet: `{
        id
        LabelOptions {
          id
          value
          displayName
        }
      }`,
    });

    if (discussionChannelData.length === 0) {
      throw new GraphQLError("DiscussionChannel not found");
    }

    const discussionChannel = discussionChannelData[0];
    const discussionChannelId = discussionChannel.id;
    const existingLabelIds = discussionChannel.LabelOptions?.map((l: { id: string }) => l.id) || [];

    // Calculate which labels to connect and disconnect
    const labelsToConnect = labelOptionIds.filter((id: string) => !existingLabelIds.includes(id));
    const labelsToDisconnect = existingLabelIds.filter((id: string) => !labelOptionIds.includes(id));

    // Get label details for labels being added
    let addedLabels: Array<{ id: string; displayName: string; value: string }> = [];
    if (labelsToConnect.length > 0) {
      const addedLabelData = await FilterOption.find({
        where: {
          id_IN: labelsToConnect,
        },
        selectionSet: `{
          id
          displayName
          value
        }`,
      });
      addedLabels = addedLabelData.map((l: { id: string; displayName?: string | null; value: string }) => ({
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
    let labelNames: string[] = [];
    if (labelOptionIds.length > 0) {
      const labelData = await FilterOption.find({
        where: {
          id_IN: labelOptionIds,
        },
        selectionSet: `{
          id
          displayName
          value
        }`,
      });
      labelNames = labelData.map((l: { displayName?: string | null; value: string }) => l.displayName || l.value);
    }

    // Build the update operation
    const updateInput: any = {
      LabelOptions: [],
    };

    if (labelsToConnect.length > 0) {
      updateInput.LabelOptions.push({
        connect: labelsToConnect.map((id: string) => ({
          where: { node: { id } },
        })),
      });
    }

    if (labelsToDisconnect.length > 0) {
      updateInput.LabelOptions.push({
        disconnect: labelsToDisconnect.map((id: string) => ({
          where: { node: { id } },
        })),
      });
    }

    // Apply the update
    const updateResult = await DiscussionChannel.update({
      where: { id: discussionChannelId },
      update: updateInput.LabelOptions.length > 0 ? { LabelOptions: updateInput.LabelOptions } : {},
      selectionSet: `{
        discussionChannels {
          id
          LabelOptions {
            id
            value
            displayName
            order
            group {
              id
              key
              displayName
            }
          }
        }
      }`,
    });

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

        await LabelChangeHistory.create({
          input: [historyInput],
        });
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

        await LabelChangeHistory.create({
          input: [historyInput],
        });
      }
    } catch (error) {
      console.error("Error creating label change history:", error);
      // Don't fail the label update if history creation fails
    }

    // If the user is not the owner (i.e., is a mod), create a moderation action record
    if (!isOwner && hasModPermission && loggedInModName) {
      const actionDescription = labelNames.length > 0
        ? `Updated download labels to: ${labelNames.join(", ")} on "${discussion.title || 'untitled'}"`
        : `Removed all download labels from "${discussion.title || 'untitled'}"`;

      const moderationActionInput: ModerationActionCreateInput = {
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
        await ModerationAction.create({
          input: [moderationActionInput],
        });
      } catch (error) {
        console.error("Error creating moderation action:", error);
        // Don't fail the label update if moderation action creation fails
      }
    }

    return updatedDiscussionChannel;
  };
};

export default getResolver;
