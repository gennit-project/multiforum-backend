import type { Driver } from "neo4j-driver";
import type { GraphQLResolveInfo } from "graphql";
import { updateEventChannelQuery, severConnectionBetweenEventAndChannelQuery } from "../cypher/cypherQueries.js";
import { EventWhere, EventUpdateInput } from "../../src/generated/graphql.js";
import { sendBatchEmails } from "../../services/mail/index.js";
import { createEventUpdateNotificationEmail } from "./shared/emailUtils.js";
import { buildEventUpdateNotificationPayload } from "../../services/eventUpdateNotifications.js";
import type { GraphQLContext } from "../../types/context.js";
import type { EventModel } from "../../ogm_types.js";
import { eventVersionHistoryHandler } from "../../hooks/eventVersionHistoryHook.js";
import { logger } from "../../logger.js";

type Input = {
  Event: EventModel;
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
  const { Event, driver, dependencies } = input;
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

    const session = driver.session();

    try {
      const existingEvents = await Event.find({
        where,
        selectionSet: `
          {
            id
            title
            description
            startTime
            endTime
            locationName
            address
            virtualEventUrl
            canceled
            Poster { username }
            DescriptionLastEditedBy { username }
            EventChannels { channelUniqueName }
            PastTitleVersions { id body createdAt }
            PastDescriptionVersions { id body createdAt }
          }
        `,
      });

      const existingEvent = existingEvents[0];
      if (!existingEvent) {
        throw new Error("Event not found");
      }

      const updatedEventId = where.id;

      await session.executeWrite(async (transaction) => {
        await Event.update({
          where,
          update: eventUpdateInput,
          context: { executionContext: transaction },
        });

        for (const channelUniqueName of channelConnections) {
          await transaction.run(updateEventChannelQuery, {
            eventId: updatedEventId,
            channelUniqueName,
          });
        }

        for (const channelUniqueName of channelDisconnections) {
          await transaction.run(severConnectionBetweenEventAndChannelQuery, {
            eventId: updatedEventId,
            channelUniqueName,
          });
        }
      });

      // Version-history writes happen once after the retryable business write.
      // They use the pre-update snapshot without putting logging or other
      // non-database effects inside the managed callback.
      if (where.id) {
        await eventVersionHistoryHandler({
          context,
          params: {
            where: { id: where.id },
            update: {
              title: eventUpdateInput.title,
              description: eventUpdateInput.description,
            },
          },
          eventSnapshot: existingEvent,
        });
      }
      // Refetch the newly created event with the channel connections
      // and disconnections so that we can return it.
      const selectionSet = `
        {
          id
          title
          description
          startTime
          startTimeDayOfWeek
          startTimeHourOfDay
          endTime
          locationName
          address
          virtualEventUrl
          startTimeDayOfWeek
          canceled
          cost
          isAllDay
          isHostedByOP
          coverImageURL
          Poster {
            username
          }
          EventChannels {
            id
            channelUniqueName
            eventId
            Channel {
              uniqueName
            }
            Event {
              id
            }
          }
          SubscribedToNotifications {
            username
          }
          SubscribedToEventUpdates {
            username
            Email {
              address
            }
          }
          createdAt
          updatedAt
          Tags {
            text
          }
        }
      `;

      const result = await Event.find({
        where: {
          id: updatedEventId,
        },
        selectionSet,
      });

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

        if (usersToNotify.length > 0) {
          const notificationSession = driver.session();
          try {
            await notificationSession.executeWrite((transaction) =>
              transaction.run(
                `
            UNWIND $usernames AS username
            MATCH (user:User {username: username})
            CREATE (notification:Notification {
              id: randomUUID(),
              createdAt: datetime(),
              read: false,
              text: $notificationText,
              notificationType: 'event'
            })
            CREATE (user)-[:HAS_NOTIFICATION]->(notification)
                `,
                {
                  usernames: usersToNotify.map((user: NotifiableUser) => user.username),
                  notificationText: eventUpdateNotification.notificationText,
                }
              )
            );
          } finally {
            await notificationSession.close();
          }
        }
      }

      return updatedEvent;
    } catch (error: unknown) {
      logger.error("Error updating event:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to update event. ${message}`);
    } finally {
      await session.close();
    }
  };
};

export default getResolver;
