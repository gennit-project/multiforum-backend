import type {
  Issue,
  IssueModel,
  DiscussionChannelModel,
  ModerationActionCreateInput,
  IssueWhere,
  IssueUpdateInput,
  DiscussionChannelUpdateInput,
  DiscussionChannelWhere,
} from "../../ogm_types.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import { getModerationActionCreateInput } from "./reportComment.js";

type Args = {
  discussionId: string;
  channelUniqueName: string;
  explanation: string;
};

type Input = {
  Issue: IssueModel;
  DiscussionChannel: DiscussionChannelModel;
};

const getResolver = (input: Input) => {
  const { Issue, DiscussionChannel } = input;
  return async (parent: any, args: Args, context: any, resolveInfo: any) => {
    const { discussionId, explanation, channelUniqueName } = args;

    if (!discussionId) {
      throw new GraphQLError("Discussion ID is required");
    }
    // Set loggedInUsername to null explicitly if not present
    context.user = await setUserDataOnContext({
      context,
      getPermissionInfo: false,
    });

    const loggedInUsername = context.user?.username || null;
    if (!loggedInUsername) {
      throw new GraphQLError("User must be logged in");
    }

    const loggedInModName = context.user.data.ModerationProfile.displayName;
    if (!loggedInModName) {
      throw new GraphQLError(`User ${loggedInUsername} is not a moderator`);
    }
    if (!channelUniqueName) {
      throw new GraphQLError(
        "Could not find the forum name attached to the discussion."
      );
    }

    let existingIssueId = "";
    let existingIssue: Issue | null = null;

    // Check if an issue already exists for the discussion ID and channel unique name.
    const issueData = await Issue.find({
      where: {
        channelUniqueName: channelUniqueName,
        relatedDiscussionId: discussionId,
      },
      selectionSet: `{
              id
              issueNumber
              flaggedServerRuleViolation
          }`,
    });

    if (issueData.length > 0 && issueData[0]?.id) {
      existingIssueId = issueData[0]?.id || "";
      existingIssue = issueData[0];
    } else {
      throw new GraphQLError("Issue not found");
    }

    const moderationActionCreateInput: ModerationActionCreateInput =
      getModerationActionCreateInput({
        text: explanation,
        loggedInModName,
        channelUniqueName,
        actionType: "un-archive",
        actionDescription: "Un-archived the discussion",
        issueId: existingIssueId,
      });

    // Update the issue with the new moderation action.
    const issueUpdateWhere: IssueWhere = {
      id: existingIssueId,
    };
    const issueUpdateInput: IssueUpdateInput = {
      isOpen: false, // Set the issue to closed; unarchival is often the final action.
      ActivityFeed: [
        {
          create: [
            {
              node: moderationActionCreateInput,
            },
          ],
        },
      ],
    };

    try {
      const issueData = await Issue.update({
        where: issueUpdateWhere,
        update: issueUpdateInput,
        selectionSet: `{
          issues {
            id
            issueNumber
            flaggedServerRuleViolation
          }
        }`,
      });
      const issueId = issueData.issues[0]?.id || null;
      if (!issueId) {
        throw new GraphQLError("Error updating issue");
      }
      existingIssue = issueData.issues[0];
    } catch (error) {
      throw new GraphQLError("Error updating issue");
    }

    try {
      // Update the discussionChannel so that archived=false.
      const discussionChannelUpdateWhere: DiscussionChannelWhere = {
        channelUniqueName: channelUniqueName,
        discussionId: discussionId,
      };
      const discussionChannelUpdateInput: DiscussionChannelUpdateInput = {
        archived: false,
      };
      const discussionUpdateData = await DiscussionChannel.update({
        where: discussionChannelUpdateWhere,
        update: discussionChannelUpdateInput,
      });
      const discussionUpdateId =
        discussionUpdateData.discussionChannels[0]?.id || null;
      if (!discussionUpdateId) {
        throw new GraphQLError("Error updating discussionChannel");
      }
      return existingIssue;
    } catch (error) {
      throw new GraphQLError("Error updating discussionChannel");
    }
  };
};

export default getResolver;
