import type {
  DiscussionModel,
  DiscussionChannelModel,
  FilterOptionModel,
  ModerationActionModel,
  ModerationActionCreateInput,
} from "../../ogm_types.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";

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
};

const getResolver = (input: Input) => {
  const { Discussion, DiscussionChannel, FilterOption, ModerationAction } = input;

  return async (parent: any, args: Args, context: any, resolveInfo: any) => {
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
        (c: any) => c.uniqueName === channelUniqueName
      );

      // Check if user is a server admin
      const isServerAdmin = context.user?.data?.AdminOfServers?.length > 0;

      // Check if mod has canEditDiscussions permission for the channel
      const channelModPermissions = context.user?.data?.ModerationProfile?.ModChannelRoles?.filter(
        (role: any) => role.channelUniqueName === channelUniqueName
      ) || [];

      const hasChannelModEditPermission = channelModPermissions.some(
        (role: any) => role.canEditDiscussions === true
      );

      // Check if mod has server-level canEditDiscussions permission
      const serverModPermissions = context.user?.data?.ModerationProfile?.ModServerRoles || [];
      const hasServerModEditPermission = serverModPermissions.some(
        (role: any) => role.canEditDiscussions === true
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
    const existingLabelIds = discussionChannel.LabelOptions?.map((l: any) => l.id) || [];

    // Calculate which labels to connect and disconnect
    const labelsToConnect = labelOptionIds.filter((id: string) => !existingLabelIds.includes(id));
    const labelsToDisconnect = existingLabelIds.filter((id: string) => !labelOptionIds.includes(id));

    // Get label names for the moderation action description
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
      labelNames = labelData.map((l: any) => l.displayName || l.value);
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
