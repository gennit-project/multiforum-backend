import type {
  Issue,
  IssueModel,
  DiscussionModel,
  IssueCreateInput,
  ModerationActionCreateInput,
  IssueWhere,
  IssueUpdateInput,
  DiscussionChannelUpdateInput,
  DiscussionChannelWhere,
  DiscussionChannelModel,
} from "../../ogm_types.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import { getFinalCommentText } from "./reportDiscussion.js";
import {
  getModerationActionCreateInput,
  getIssueCreateInput,
} from "./reportComment.js";
import getNextIssueNumber from "./utils/getNextIssueNumber.js";

type Args = {
  discussionId: string;
  selectedForumRules: string[];
  selectedServerRules: string[];
  reportText: string;
  channelUniqueName: string;
};

type Input = {
  Issue: IssueModel;
  Discussion: DiscussionModel;
  DiscussionChannel: DiscussionChannelModel;
  driver: any;
};

const getResolver = (input: Input) => {
  const { Issue, Discussion, DiscussionChannel, driver } = input;
  return async (parent: any, args: Args, context: any, resolveInfo: any) => {
    const {
      discussionId,
      selectedForumRules,
      selectedServerRules,
      reportText,
      channelUniqueName,
    } = args;

    if (!discussionId) {
      throw new GraphQLError("Discussion ID is required");
    }

    if (!channelUniqueName) {
      throw new GraphQLError("A forum name is required.");
    }

    const atLeastOneViolation =
      selectedForumRules?.length > 0 || selectedServerRules?.length > 0;

    if (!atLeastOneViolation) {
      throw new GraphQLError("At least one rule must be selected");
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

    let existingIssueId = "";
    let existingIssue: Issue | null = null;
    let existingIssueFlaggedServerRuleViolation = false;
    const discussionData = await Discussion.find({
      where: {
        id: discussionId,
      },
      selectionSet: `{
            id
            title
        }`,
    });

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

    if (issueData.length > 0) {
      existingIssueId = issueData[0]?.id || "";
      existingIssue = issueData[0];
      existingIssueFlaggedServerRuleViolation =
        issueData[0]?.flaggedServerRuleViolation || false;
    } else {
      // If an issue does NOT already exist, create a new issue.
      const discussionTitle = discussionData[0]?.title || "";

      const issueNumber = await getNextIssueNumber(driver, channelUniqueName);
      const issueCreateInput: IssueCreateInput = getIssueCreateInput({
        contextText: discussionTitle,
        selectedForumRules,
        selectedServerRules,
        loggedInModName,
        channelUniqueName,
        reportedContentType: "discussion",
        relatedDiscussionId: discussionId,
        issueNumber,
      })

      try {
        const issueData = await Issue.create({
          input: [issueCreateInput],
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
          throw new GraphQLError("Error creating issue");
        }
        existingIssueId = issueId;
        existingIssue = issueData.issues[0];
      } catch (error) {
        throw new GraphQLError("Error creating issue");
      }
    }

    const finalDiscussionText = getFinalCommentText({
      reportText,
      selectedForumRules,
      selectedServerRules,
    });

    try {
      // Add the activity feed item to the issue that says we archived the discussion.
      const moderationActionCreateInput: ModerationActionCreateInput =
        getModerationActionCreateInput({
          text: finalDiscussionText,
          loggedInModName,
          channelUniqueName,
          actionType: "archive",
          actionDescription: "Archived the discussion, closing the issue",
          issueId: existingIssueId,
        });
      const issueUpdateWhere: IssueWhere = {
        id: existingIssueId,
      };
      const issueUpdateInput: IssueUpdateInput = {
        ActivityFeed: [
          {
            create: [
              {
                node: moderationActionCreateInput,
              },
            ],
          },
        ],
        isOpen: false, // Close the issue; archival is often the final action.
        flaggedServerRuleViolation:
          existingIssueFlaggedServerRuleViolation ||
          selectedServerRules.length > 0,
      };

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
      // Update the discussionChannel so that archived=true and the issue is linked
      // to the discussion under RelatedIssues.
      // First we need to find the discussionChannel that matches the given discussion ID
      // and channel unique name.
      const discussionChannel = await DiscussionChannel.find({
        where: {
          discussionId: discussionId,
          channelUniqueName: channelUniqueName,
        },
        selectionSet: `{
            id
        }`,
      });
      const discussionChannelId = discussionChannel[0]?.id || null;
      if (!discussionChannelId) {
        throw new GraphQLError("Error finding discussionChannel");
      }
      const discussionChannelUpdateWhere: DiscussionChannelWhere = {
        id: discussionChannelId,
      };
      const discussionChannelUpdateInput: DiscussionChannelUpdateInput = {
        archived: true,
        RelatedIssues: [
          {
            connect: [
              {
                where: {
                  node: {
                    id: existingIssueId,
                  },
                },
              },
            ],
          },
        ],
      };
      const discussionChannelUpdateData = await DiscussionChannel.update({
        where: discussionChannelUpdateWhere,
        update: discussionChannelUpdateInput,
      });
      const discussionChannelUpdateId =
        discussionChannelUpdateData.discussionChannels[0]?.id || null;
      if (!discussionChannelUpdateId) {
        throw new GraphQLError("Error updating discussionChannel");
      }
      return existingIssue;
    } catch (error) {
      console.log("Error creating issue", error);
      return false;
    }
  };
};

export default getResolver;
