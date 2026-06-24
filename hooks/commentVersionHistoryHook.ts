import {
  createIssueActivityFeedItems,
  getAttributionFromContext,
  getIssueIdsForRelated,
} from './issueActivityFeedHelpers.js';
import { createInAppNotification } from './notificationHelpers.js';
import type { GraphQLContext } from '../types/context.js';
import type {
  CommentModel,
  CommentUpdateInput,
  TextVersionModel,
  UserModel,
} from '../ogm_types.js';
import type { TextVersionCreateInput } from '../src/generated/graphql.js';
import type { CommentSnapshot } from '../utils/buildCommentMentionContext.js';
import { logger } from "../logger.js";

type VersionHistoryHandlerInput = {
  context: GraphQLContext;
  params: { where?: { id?: string | null }; update?: { text?: string | null } | null };
  commentSnapshot?: CommentSnapshot | null;
};

/**
 * Hook to track comment version history when a comment is updated
 * This will capture the old text before the update is applied
 */
export const commentVersionHistoryHandler = async ({
  context,
  params,
  commentSnapshot,
}: VersionHistoryHandlerInput) => {
  try {
    logger.info('Comment version history hook running...');
    
    // Extract parameters from the update operation
    const { where, update } = params;
    const commentId = where?.id;
    
    // Make sure we have a comment ID and update data
    if (!commentId || !update) {
      logger.info('Missing comment ID or update data');
      return;
    }
    
    // Check if text is being updated
    const isTextUpdated = update.text !== undefined;
    
    // If text is not being updated, skip version tracking
    if (!isTextUpdated) {
      logger.info('No text updates detected, skipping version history');
      return;
    }
    
    logger.info('Processing version history for comment:', commentId);
    
    // Access OGM models
    const { ogm } = context;
    const CommentModel = ogm.model('Comment');
    const TextVersionModel = ogm.model('TextVersion');
    const UserModel = ogm.model('User');
    const IssueModel = ogm.model('Issue');
    
    let comment: CommentSnapshot | null | undefined = commentSnapshot;

    if (!comment) {
      // Fetch the current comment to get current values before update
      const comments = await CommentModel.find({
        where: { id: commentId },
        selectionSet: `{
          id
          text
          CommentAuthor {
            ... on User {
              username
            }
            ... on ModerationProfile {
              displayName
              User {
                username
              }
            }
          }
          DiscussionChannel {
            discussionId
            channelUniqueName
            Discussion {
              id
              title
            }
          }
          Event {
            id
            title
            EventChannels {
              channelUniqueName
            }
          }
          PastVersions {
            id
            body
            createdAt
          }
        }`
      });

      if (!comments.length) {
        logger.info('Comment not found');
        return;
      }

      comment = comments[0] as unknown as CommentSnapshot;
    }
    
    // Get the username from CommentAuthor which can be either User or ModerationProfile
    const commentAuthor = comment.CommentAuthor;
    if (!commentAuthor) {
      logger.info('Comment author information not found');
      return;
    }

    const username = context?.user?.username || commentAuthor.username || null;
    const editorLabel =
      context?.user?.data?.ModerationProfile?.displayName ||
      context?.user?.username ||
      'A moderator';
    const authorUsername =
      commentAuthor?.username || commentAuthor?.User?.username || null;

    // Track text version history if text is being updated
    // Save the NEW text (post-edit) with the current user attribution
    if (isTextUpdated && update.text !== comment.text) {
      await trackTextVersionHistory(
        commentId,
        comment.text,
        username,
        CommentModel,
        TextVersionModel,
        UserModel
      );

      if (authorUsername && username && authorUsername !== username) {
        const { DiscussionChannel, Event } = comment;
        let notificationUrl = '';
        let notificationContext = '';

        if (
          DiscussionChannel?.channelUniqueName &&
          DiscussionChannel?.discussionId
        ) {
          notificationUrl = `${process.env.FRONTEND_URL}/forums/${DiscussionChannel.channelUniqueName}/discussions/${DiscussionChannel.discussionId}/comments/${commentId}`;
          notificationContext =
            DiscussionChannel.Discussion?.title || 'discussion';
        } else if (Event?.id && Event?.EventChannels?.length) {
          const eventChannelName = Event.EventChannels[0]?.channelUniqueName;
          if (eventChannelName) {
            notificationUrl = `${process.env.FRONTEND_URL}/forums/${eventChannelName}/events/${Event.id}/comments/${commentId}`;
            notificationContext = Event.title || 'event';
          }
        }

        if (notificationUrl && notificationContext) {
          const notificationText = `${editorLabel} edited your comment on [${notificationContext}](${notificationUrl})`;
          await createInAppNotification({
            UserModel,
            username: authorUsername,
            text: notificationText,
          });
        }
      }

      const issueIds = await getIssueIdsForRelated(IssueModel, {
        commentId,
      });
      if (!issueIds.length) {
        return;
      }

      const attribution = getAttributionFromContext(context);
      await createIssueActivityFeedItems({
        IssueModel,
        driver: context?.driver,
        issueIds,
        actionDescription: 'edited the comment',
        actionType: 'edit',
        attribution,
        actorUsername: context?.user?.username || null,
        commentId,
      });
    } else {
      logger.info('No text changes to track or current text is empty');
    }
  } catch (error) {
    logger.error('Error in comment version history hook:', error);
    // Don't re-throw the error, so we don't affect the mutation
  }
};

/**
 * Track text version history for a comment
 */
async function trackTextVersionHistory(
  commentId: string,
  newText: string | null | undefined,
  username: string | null,
  CommentModel: CommentModel,
  TextVersionModel: TextVersionModel,
  UserModel: UserModel
) {
  logger.info(
    `Tracking text version history for comment ${commentId} by user ${username ?? '[unknown]'}`
  );

  try {
    // Skip tracking if new text is null or empty
    if (!newText) {
      logger.info('New text is empty, skipping version history');
      return;
    }

    const textVersionInput: TextVersionCreateInput = {
      body: newText,
    };

    if (username) {
      const users = await UserModel.find({
        where: { username },
        selectionSet: `{ username }`,
      });

      if (users.length) {
        textVersionInput.Author = {
          connect: { where: { node: { username } } },
        };
      }
    }

    // Create new TextVersion for the old text
    // The createdAt timestamp will be automatically set by @timestamp directive
    const textVersionResult = await TextVersionModel.create({
      input: [textVersionInput],
    });

    if (!textVersionResult.textVersions.length) {
      logger.info('Failed to create TextVersion');
      return;
    }

    const textVersionId = textVersionResult.textVersions[0].id;

    // Fetch the current comment
    const comments = await CommentModel.find({
      where: { id: commentId },
      selectionSet: `{
        id
      }`
    });

    if (!comments.length) {
      logger.info('Comment not found when updating version order');
      return;
    }

    // Update comment to connect the new TextVersion and set textLastEdited
    await CommentModel.update({
      where: { id: commentId },
      update: {
        textLastEdited: new Date().toISOString(),
        PastVersions: {
          connect: [{
            where: {
              node: { id: textVersionId }
            }
          }]
        }
      } as unknown as CommentUpdateInput
    });

    logger.info(`Successfully added text version history for comment ${commentId}`);
  } catch (error) {
    logger.error('Error tracking text version history:', error);
  }
}
