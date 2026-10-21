import { createEventRevisionRepository, type EventRevisionRepository, type EventRevisionSnapshot } from "../services/persistence/eventRevisionRepository.js";
import { createIssueActivityRepository } from "../services/persistence/issueActivityRepository.js";

import {
  createIssueActivityFeedItems,
  getAttributionFromContext,
  getIssueIdsForRelated,
} from './issueActivityFeedHelpers.js';
import { createInAppNotification } from './notificationHelpers.js';
import type { GraphQLContext } from '../types/context.js';
import { logger } from "../logger.js";
export type EventSnapshot = EventRevisionSnapshot;

type EventVersionHistoryHandlerInput = {
  context: GraphQLContext;
  params: {
    where?: { id?: string | null };
    update?: { title?: string | null; description?: string | null } | null;
  };
  eventSnapshot?: EventSnapshot | null;
};

/**
 * Hook to track event version history when an event is updated.
 * This captures the old title and description before the update is applied,
 * mirroring the discussion version history behavior.
 */
export const eventVersionHistoryHandler = async ({
  context,
  params,
  eventSnapshot,
}: EventVersionHistoryHandlerInput) => {
  try {
    logger.info('Event version history hook running...');

    const { where, update } = params;
    const eventId = where?.id;

    if (!eventId || !update) {
      logger.info('Missing event ID or update data');
      return;
    }

    // Check if title or description is being updated
    const isTitleUpdated =
      update.title !== undefined && update.title !== eventSnapshot?.title;
    const isDescriptionUpdated =
      update.description !== undefined &&
      update.description !== eventSnapshot?.description;

    if (!isTitleUpdated && !isDescriptionUpdated) {
      logger.info(
        'No title or description updates detected, skipping version history'
      );
      return;
    }

    logger.info('Processing version history for event:', eventId);

    const repository = context.eventRevisionRepository ?? createEventRevisionRepository(context.driver);
    const issueActivityRepository = context.issueActivityRepository ?? createIssueActivityRepository(context.driver);

    let event: EventSnapshot | null | undefined = eventSnapshot;

    if (!event) {
      const events = await repository.findSnapshot(eventId);

      if (!events.length) {
        logger.info('Event not found');
        return;
      }

      event = events[0] as EventSnapshot;
    }

    // The editor making this change (for updating DescriptionLastEditedBy after)
    const editorUsername = context?.user?.username;

    // The author of the current description content (who we attribute the
    // TextVersion to). Use DescriptionLastEditedBy if set, otherwise fall back
    // to the original Poster (OP).
    const descriptionContentAuthor =
      event.DescriptionLastEditedBy?.username || event.Poster?.username;

    // For title, we attribute the replaced version to the editor.
    const titleEditor = editorUsername || event.Poster?.username;

    if (!titleEditor) {
      logger.info('Author username not found');
      return;
    }

    const createdRevisionIds: Array<{ id: string; type: 'title' | 'description' }> = [];

    if (isTitleUpdated && update.title !== event.title) {
      const titleRevisionId = await trackTitleVersionHistory(
        eventId,
        event.title ?? '',
        titleEditor,
        repository
      );
      if (titleRevisionId) {
        createdRevisionIds.push({ id: titleRevisionId, type: 'title' });
      }
    }

    if (isDescriptionUpdated && update.description !== event.description) {
      const descriptionRevisionId = await trackDescriptionVersionHistory(
        eventId,
        event.description,
        descriptionContentAuthor || '[Unknown]',
        repository
      );
      if (descriptionRevisionId) {
        createdRevisionIds.push({ id: descriptionRevisionId, type: 'description' });
      }

      // Update DescriptionLastEditedBy to the current editor
      if (editorUsername) {
        await repository.replaceDescriptionEditor(eventId, editorUsername);
      }
    }

    if (!createdRevisionIds.length) {
      return;
    }

    const issueIds = await getIssueIdsForRelated(issueActivityRepository, {
      eventId,
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
            ? 'edited the event title'
            : 'edited the event description',
        actionType: 'edit',
        attribution,
        actorUsername: context?.user?.username || null,
        revisionId: revision.id,
      });
    }
  } catch (error) {
    logger.error('Error in event version history hook:', error);
    // Don't re-throw the error, so we don't affect the mutation
  }
};

export const eventEditNotificationHandler = async ({
  context,
  params,
  eventSnapshot,
}: EventVersionHistoryHandlerInput) => {
  try {
    const { where, update } = params;
    const eventId = where?.id;

    if (!eventId || !update || !eventSnapshot) {
      return;
    }

    const isTitleUpdated = update.title !== undefined;
    const isDescriptionUpdated = update.description !== undefined;

    if (!isTitleUpdated && !isDescriptionUpdated) {
      return;
    }

    const editorUsername = context?.user?.username || null;
    const editorLabel =
      context?.user?.data?.ModerationProfile?.displayName ||
      editorUsername ||
      'A moderator';
    const authorUsername = eventSnapshot?.Poster?.username || null;

    if (!authorUsername || !editorUsername || authorUsername === editorUsername) {
      return;
    }

    const channelName =
      eventSnapshot?.EventChannels?.[0]?.channelUniqueName || null;

    if (!channelName) {
      return;
    }

    const notificationUrl = `${process.env.FRONTEND_URL}/forums/${channelName}/events/${eventId}`;
    const eventTitle = eventSnapshot?.title || 'event';
    const notificationText = `${editorLabel} edited your event [${eventTitle}](${notificationUrl})`;

    await createInAppNotification({
      context,
      username: authorUsername,
      text: notificationText,
    });
  } catch (error) {
    logger.error('Error in event edit notification hook:', error);
  }
};

/**
 * Track title version history for an event
 */
async function trackTitleVersionHistory(
  eventId: string,
  previousTitle: string,
  username: string,
  repository: EventRevisionRepository
): Promise<string | null> {
  logger.info(`Tracking title version history for event ${eventId}`);

  try {
    const users = await repository.findVersionAuthor(username);

    if (!users.length) {
      logger.info('User not found');
      return null;
    }

    const textVersionResult = await repository.createPreviousText(previousTitle, username);

    if (!textVersionResult.textVersions.length) {
      logger.info('Failed to create TextVersion');
      return null;
    }

    const textVersionId = textVersionResult.textVersions[0].id;

    await repository.connectTitleVersion(eventId, textVersionId);

    logger.info(`Successfully added title version history for event ${eventId}`);
    return textVersionId;
  } catch (error) {
    logger.error('Error tracking title version history:', error);
    return null;
  }
}

/**
 * Track description version history for an event
 */
async function trackDescriptionVersionHistory(
  eventId: string,
  previousDescription: string | null | undefined,
  username: string,
  repository: EventRevisionRepository
): Promise<string | null> {
  logger.info(`Tracking description version history for event ${eventId}`);

  try {
    // Normalize null/undefined to empty string so mod edits of an empty
    // description are still attributed in the revision history.
    const descriptionToTrack = previousDescription ?? '';

    const users = await repository.findVersionAuthor(username);

    if (!users.length) {
      logger.info('User not found');
      return null;
    }

    const textVersionResult = await repository.createPreviousText(descriptionToTrack, username);

    if (!textVersionResult.textVersions.length) {
      logger.info('Failed to create TextVersion');
      return null;
    }

    const textVersionId = textVersionResult.textVersions[0].id;

    await repository.connectDescriptionVersion(eventId, textVersionId);

    logger.info(`Successfully added description version history for event ${eventId}`);
    return textVersionId;
  } catch (error) {
    logger.error('Error tracking description version history:', error);
    return null;
  }
}
