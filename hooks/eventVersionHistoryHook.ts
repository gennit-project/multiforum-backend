import { type EventRevisionSnapshot } from "../services/persistence/eventRevisionRepository.js";
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

/** Activity and its subscriber notifications run only after a confirmed commit. */
export async function eventRevisionActivityHandler(context: GraphQLContext, eventId: string, revisions: Array<{id: string; type: 'title' | 'description'}>) {
  if (!revisions.length) return;
  const repository = context.issueActivityRepository ?? createIssueActivityRepository(context.driver);
  const issueIds = await getIssueIdsForRelated(repository, {eventId});
  for (const revision of revisions) {
    await createIssueActivityFeedItems({
      issueActivityRepository: repository, driver: context.driver, issueIds,
      actionDescription: revision.type === 'title' ? 'edited the event title' : 'edited the event description',
      actionType: 'edit', attribution: getAttributionFromContext(context),
      actorUsername: context.user?.username || null, revisionId: revision.id,
    });
  }
}

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
