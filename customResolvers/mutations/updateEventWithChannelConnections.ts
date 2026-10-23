import type { Driver } from "neo4j-driver";
import type { GraphQLResolveInfo } from "graphql";
import { EventWhere, EventUpdateInput } from "../../src/generated/graphql.js";
import { sendBatchEmails } from "../../services/mail/index.js";
import { createEventUpdateNotificationEmail } from "./shared/emailUtils.js";
import { buildEventUpdateNotificationPayload } from "../../services/eventUpdateNotifications.js";
import { createInAppNotificationsForUsers } from "../../services/inAppNotifications.js";
import { executeManagedWrite } from "../../services/neo4jTransactions.js";
import type { GraphQLContext } from "../../types/context.js";
import { createEventWriteRepository, type EventWriteRepository } from "../../services/persistence/eventWriteRepository.js";
import { eventVersionHistoryHandler } from "../../hooks/eventVersionHistoryHook.js";
import { logger } from "../../logger.js";
import { applyEventChannelChanges } from "./shared/eventChannelChanges.js";

type Input = {
  eventWriteRepository?: EventWriteRepository;
  driver: Driver;
  dependencies?: {
    sendBatchEmails?: typeof sendBatchEmails;
    createEventUpdateNotificationEmail?: typeof createEventUpdateNotificationEmail;
    buildEventUpdateNotificationPayload?: typeof buildEventUpdateNotificationPayload;
  };
};

type Args = {
  where: EventWhere;
  eventUpdateInput: EventUpdateInput;
  channelConnections: string[];
  channelDisconnections: string[];
};

type NotifiableUser = {
  username: string;
  Email?: { address: string } | null;
};

const getResolver = (input: Input) => {
  const { driver, dependencies } = input;
  const repository = input.eventWriteRepository ?? createEventWriteRepository(driver);
  const sendBatchEmailsFn = dependencies?.sendBatchEmails || sendBatchEmails;
  const createEventUpdateNotificationEmailFn =
    dependencies?.createEventUpdateNotificationEmail ||
    createEventUpdateNotificationEmail;
  const buildEventUpdateNotificationPayloadFn =
    dependencies?.buildEventUpdateNotificationPayload ||
    buildEventUpdateNotificationPayload;
  return async (parent: unknown, args: Args, context: GraphQLContext, info: GraphQLResolveInfo) => {
    const {
      where,
      eventUpdateInput,
      channelConnections,
      channelDisconnections,
    } = args;

    try {
      const existingEvents = await repository.findUpdateSnapshot(where);

      const existingEvent = existingEvents[0];
      if (!existingEvent) {
        throw new Error("Event not found");
      }

      const updatedEventId = where.id?.eq;

      await executeManagedWrite(driver, async (transaction) => {
        await repository.updateWithinTransaction(where, eventUpdateInput, transaction);

        await applyEventChannelChanges({
          transaction,
          eventId: updatedEventId,
          channelConnections,
          channelDisconnections,
        });
      });

      // Version-history writes happen once after the retryable business write.
      // They use the pre-update snapshot without putting logging or other
      // non-database effects inside the managed callback.
      if (where.id) {
        await eventVersionHistoryHandler({
          context,
          params: {
            where: { id: where.id?.eq },
            update: {
              title: eventUpdateInput.title?.set,
              description: eventUpdateInput.description?.set,
            },
          },
          eventSnapshot: existingEvent,
        });
      }
      // Refetch the newly created event with the channel connections
      // and disconnections so that we can return it.
      const result = await repository.findUpdatedEvent(updatedEventId);

      const updatedEvent = result[0];
      const eventUpdateNotification = buildEventUpdateNotificationPayloadFn(
        existingEvent,
        updatedEvent
      );

      if (eventUpdateNotification) {
        const actorUsername = context.user?.username || null;
        const usersToNotify = (updatedEvent.SubscribedToEventUpdates || []).filter(
          (user: NotifiableUser) => user.username !== actorUsername
        );
        const emailContent = createEventUpdateNotificationEmailFn(
          updatedEvent.title,
          eventUpdateNotification.summaryLines,
          eventUpdateNotification.eventUrl,
          eventUpdateNotification.subject
        );

        const emailRecipients = usersToNotify
          .filter((user: NotifiableUser) => user.Email?.address)
          .map((user: NotifiableUser) => ({
            to: user.Email!.address,
            subject: emailContent.subject,
            text: emailContent.plainText,
            html: emailContent.html,
        }));

        if (emailRecipients.length > 0) {
          await sendBatchEmailsFn(emailRecipients);
        }

        await createInAppNotificationsForUsers({
          driver,
          usernames: usersToNotify.map((user: NotifiableUser) => user.username),
          notificationText: eventUpdateNotification.notificationText,
          notificationType: "event",
        });
      }

      return updatedEvent;
    } catch (error: unknown) {
      logger.error("Error updating event:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to update event. ${message}`);
    }
  };
};

export default getResolver;
