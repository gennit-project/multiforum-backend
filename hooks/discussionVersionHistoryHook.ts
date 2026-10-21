import { createDiscussionRevisionRepository, type DiscussionRevisionRepository, type DiscussionSnapshot } from "../services/persistence/discussionRevisionRepository.js";
import { createIssueActivityRepository } from "../services/persistence/issueActivityRepository.js";

import {
  createIssueActivityFeedItems,
  getAttributionFromContext,
  getIssueIdsForRelated,
} from './issueActivityFeedHelpers.js';
import { createInAppNotification } from './notificationHelpers.js';
import type { GraphQLContext } from '../types/context.js';
import { logger } from "../logger.js";


type DiscussionVersionHistoryHandlerInput = {
  context: GraphQLContext;
  params: {
    where?: { id?: string | null };
    update?: { title?: string | null; body?: string | null } | null;
  };
  discussionSnapshot?: DiscussionSnapshot | null;
};

/**
 * Hook to track discussion version history when a discussion is updated
 * This will capture the old title and body before the update is applied
 */
export const discussionVersionHistoryHandler = async ({
  context,
  params,
  discussionSnapshot,
}: DiscussionVersionHistoryHandlerInput) => {
  try {
    logger.info('Discussion version history hook running...');
    
    // Extract parameters from the update operation
    const { where, update } = params;
    const discussionId = where?.id;
    
    // Make sure we have a discussion ID and update data
    if (!discussionId || !update) {
      logger.info('Missing discussion ID or update data');
      return;
    }
    
    // Check if title or body is being updated
    const isTitleUpdated =
      update.title !== undefined && update.title !== discussionSnapshot?.title;
    const isBodyUpdated =
      update.body !== undefined && update.body !== discussionSnapshot?.body;
    
    // If neither title nor body is being updated, skip version tracking
    if (!isTitleUpdated && !isBodyUpdated) {
      logger.info('No title or body updates detected, skipping version history');
      return;
    }
    
    logger.info('Processing version history for discussion:', discussionId);
    
    // Resolve the finite revision and issue activity operations
    const repository = context.discussionRevisionRepository ?? createDiscussionRevisionRepository(context.driver);
    const issueActivityRepository = context.issueActivityRepository ?? createIssueActivityRepository(context.driver);
    
    // Fetch the current discussion to get current values before update
    let discussion: DiscussionSnapshot | null | undefined = discussionSnapshot;

    if (!discussion) {
      const discussions = await repository.findSnapshot(discussionId);

      if (!discussions.length) {
        logger.info('Discussion not found');
        return;
      }

      discussion = discussions[0] as DiscussionSnapshot;
    }

    // The editor making this change (for updating BodyLastEditedBy after)
    const editorUsername = context?.user?.username;

    // The author of the current body content (who we attribute the TextVersion to)
    // Use BodyLastEditedBy if set, otherwise fall back to the original Author (OP)
    const bodyContentAuthor = discussion.BodyLastEditedBy?.username || discussion.Author?.username;

    // For title, we still use the editor's username (existing behavior)
    const titleEditor = editorUsername || discussion.Author?.username;

    if (!titleEditor) {
      logger.info('Author username not found');
      return;
    }

    const createdRevisionIds: Array<{ id: string; type: 'title' | 'body' }> = [];

    // Track title version history if title is being updated
    if (isTitleUpdated && update.title !== discussion.title) {
      const titleRevisionId = await trackTitleVersionHistory(
        discussionId,
        discussion.title ?? '',
        titleEditor,
        repository
      );
      if (titleRevisionId) {
        createdRevisionIds.push({ id: titleRevisionId, type: 'title' });
      }
    }

    // Track body version history if body is being updated
    if (isBodyUpdated && update.body !== discussion.body) {
      // Use the content author (who wrote the body being replaced) for TextVersion.Author
      const bodyRevisionId = await trackBodyVersionHistory(
        discussionId,
        discussion.body,
        bodyContentAuthor || '[Unknown]',
        repository
      );
      if (bodyRevisionId) {
        createdRevisionIds.push({ id: bodyRevisionId, type: 'body' });
      }

      // Update BodyLastEditedBy to the current editor
      if (editorUsername) {
        await repository.setBodyEditor(discussionId, editorUsername);
      }
    }

    if (!createdRevisionIds.length) {
      return;
    }

    const issueIds = await getIssueIdsForRelated(issueActivityRepository, {
      discussionId,
    });
    if (!issueIds.length) {
      return;
    }

    const attribution = getAttributionFromContext(context);
    for (const revision of createdRevisionIds) {
      await createIssueActivityFeedItems({
        issueActivityRepository,
        driver: context?.driver,
        issueIds,
        actionDescription:
          revision.type === 'title'
            ? 'edited the discussion title'
            : 'edited the discussion body',
        actionType: 'edit',
        attribution,
        actorUsername: context?.user?.username || null,
        revisionId: revision.id,
      });
    }
  } catch (error) {
    logger.error('Error in discussion version history hook:', error);
    // Don't re-throw the error, so we don't affect the mutation
  }
};

export const discussionEditNotificationHandler = async ({
  context,
  params,
  discussionSnapshot,
}: DiscussionVersionHistoryHandlerInput) => {
  try {
    const { where, update } = params;
    const discussionId = where?.id;

    if (!discussionId || !update || !discussionSnapshot) {
      return;
    }

    const isTitleUpdated = update.title !== undefined;
    const isBodyUpdated = update.body !== undefined;

    if (!isTitleUpdated && !isBodyUpdated) {
      return;
    }

    const editorUsername = context?.user?.username || null;
    const editorLabel =
      context?.user?.data?.ModerationProfile?.displayName ||
      editorUsername ||
      'A moderator';
    const authorUsername = discussionSnapshot?.Author?.username || null;

    if (!authorUsername || !editorUsername || authorUsername === editorUsername) {
      return;
    }

    const channelName =
      discussionSnapshot?.DiscussionChannels?.[0]?.channelUniqueName || null;

    if (!channelName) {
      return;
    }

    const notificationUrl = `${process.env.FRONTEND_URL}/forums/${channelName}/discussions/${discussionId}`;
    const discussionTitle = discussionSnapshot?.title || 'discussion';
    const notificationText = `${editorLabel} edited your discussion [${discussionTitle}](${notificationUrl})`;

    await createInAppNotification({
      context,
      username: authorUsername,
      text: notificationText,
    });
  } catch (error) {
    logger.error('Error in discussion edit notification hook:', error);
  }
};

/**
 * Track title version history for a discussion
 */
async function trackTitleVersionHistory(
  discussionId: string,
  previousTitle: string,
  username: string,
  repository: DiscussionRevisionRepository
): Promise<string | null> {
  logger.info(`Tracking title version history for discussion ${discussionId}`);
  logger.info(`Previous title: "${previousTitle}"`);

  try {
    // Get user by username
    const users = await repository.findAuthor(username);

    if (!users.length) {
      logger.info('User not found');
      return null;
    }

    // Create new TextVersion for previous title
    // The createdAt timestamp will be automatically set by @timestamp directive
    const textVersionResult = await repository.createRevision(previousTitle, username);

    if (!textVersionResult.textVersions.length) {
      logger.info('Failed to create TextVersion');
      return null;
    }

    const textVersionId = textVersionResult.textVersions[0].id;

    // Fetch the current discussion to get current title version order
    const discussions = await repository.findDiscussionId(discussionId);

    if (!discussions.length) {
      logger.info('Discussion not found when updating version order');
      return null;
    }
    
    // Update discussion to connect the new TextVersion
    await repository.connectTitleRevision(discussionId, textVersionId);

    logger.info(`Successfully added title version history for discussion ${discussionId}`);
    return textVersionId;
  } catch (error) {
    logger.error('Error tracking title version history:', error);
    return null;
  }
}

/**
 * Track body version history for a discussion
 */
async function trackBodyVersionHistory(
  discussionId: string,
  previousBody: string | null | undefined,
  username: string,
  repository: DiscussionRevisionRepository
): Promise<string | null> {
  logger.info(`Tracking body version history for discussion ${discussionId}`);

  try {
    // Normalize null/undefined to empty string - we want to track edits
    // even when the previous body was empty, so the mod edit is properly
    // attributed in the revision history and activity feed
    const bodyToTrack = previousBody ?? '';

    // Get user by username
    const users = await repository.findAuthor(username);

    if (!users.length) {
      logger.info('User not found');
      return null;
    }

    // Create new TextVersion for previous body
    // The createdAt timestamp will be automatically set by @timestamp directive
    const textVersionResult = await repository.createRevision(bodyToTrack, username);

    if (!textVersionResult.textVersions.length) {
      logger.info('Failed to create TextVersion');
      return null;
    }

    const textVersionId = textVersionResult.textVersions[0].id;

    // Fetch the current discussion
    const discussions = await repository.findDiscussionId(discussionId);

    if (!discussions.length) {
      logger.info('Discussion not found when updating version order');
      return null;
    }

    // Update discussion to connect the new TextVersion
    await repository.connectBodyRevision(discussionId, textVersionId);

    logger.info(`Successfully added body version history for discussion ${discussionId}`);
    return textVersionId;
  } catch (error) {
    logger.error('Error tracking body version history:', error);
    return null;
  }
}
