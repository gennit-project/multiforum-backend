import { updateEventChannelQuery, severConnectionBetweenEventAndChannelQuery } from "../cypher/cypherQueries.js";
import { sendBatchEmails } from "../../services/mail/index.js";
import { createEventUpdateNotificationEmail } from "./shared/emailUtils.js";
import { buildEventUpdateNotificationPayload } from "../../services/eventUpdateNotifications.js";
const getResolver = (input) => {
    const { Event, driver, dependencies } = input;
    const sendBatchEmailsFn = (dependencies === null || dependencies === void 0 ? void 0 : dependencies.sendBatchEmails) || sendBatchEmails;
    const createEventUpdateNotificationEmailFn = (dependencies === null || dependencies === void 0 ? void 0 : dependencies.createEventUpdateNotificationEmail) ||
        createEventUpdateNotificationEmail;
    const buildEventUpdateNotificationPayloadFn = (dependencies === null || dependencies === void 0 ? void 0 : dependencies.buildEventUpdateNotificationPayload) ||
        buildEventUpdateNotificationPayload;
    return async (parent, args, context, info) => {
        var _a;
        const { where, eventUpdateInput, channelConnections, channelDisconnections, } = args;
        const session = driver.session();
        try {
            const existingEvents = await Event.find({
                where,
                selectionSet: `
          {
            id
            title
            startTime
            endTime
            locationName
            address
            virtualEventUrl
            canceled
          }
        `,
            });
            const existingEvent = existingEvents[0];
            if (!existingEvent) {
                throw new Error("Event not found");
            }
            // Update the event
            await Event.update({
                where: where,
                update: eventUpdateInput,
            });
            const updatedEventId = where.id;
            // Update the channel connections
            for (let i = 0; i < channelConnections.length; i++) {
                const channelUniqueName = channelConnections[i];
                // For each channel connection, create a EventChannel node
                // if one does not already exist.
                // Join the EventChannel to the Event and Channel nodes.
                // If there was an existing one, join that. If we just created one,
                // join that.
                await session.run(updateEventChannelQuery, {
                    eventId: updatedEventId,
                    channelUniqueName: channelUniqueName,
                });
            }
            // Update the channel disconnections
            for (let i = 0; i < channelDisconnections.length; i++) {
                const channelUniqueName = channelDisconnections[i];
                // For each channel disconnection, sever the connection between
                // the Event and the EventChannel node.
                // We intentionally do not delete the EventChannel node
                // because it contains comments that are authored by other users
                // than the event poster, and the event poster should
                // not have permission to delete those comments.
                await session.run(severConnectionBetweenEventAndChannelQuery, {
                    eventId: updatedEventId,
                    channelUniqueName: channelUniqueName,
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
            const eventUpdateNotification = buildEventUpdateNotificationPayloadFn(existingEvent, updatedEvent);
            if (eventUpdateNotification) {
                const actorUsername = ((_a = context.user) === null || _a === void 0 ? void 0 : _a.username) || null;
                const usersToNotify = (updatedEvent.SubscribedToEventUpdates || []).filter((user) => user.username !== actorUsername);
                const emailContent = createEventUpdateNotificationEmailFn(updatedEvent.title, eventUpdateNotification.summaryLines, eventUpdateNotification.eventUrl, eventUpdateNotification.subject);
                const emailRecipients = usersToNotify
                    .filter((user) => { var _a; return (_a = user.Email) === null || _a === void 0 ? void 0 : _a.address; })
                    .map((user) => ({
                    to: user.Email.address,
                    subject: emailContent.subject,
                    text: emailContent.plainText,
                    html: emailContent.html,
                }));
                if (emailRecipients.length > 0) {
                    await sendBatchEmailsFn(emailRecipients);
                }
                if (usersToNotify.length > 0) {
                    const notificationSession = driver.session();
                    await notificationSession.run(`
            UNWIND $usernames AS username
            MATCH (user:User {username: username})
            CREATE (notification:Notification {
              id: randomUUID(),
              createdAt: datetime(),
              read: false,
              text: $notificationText
            })
            CREATE (user)-[:HAS_NOTIFICATION]->(notification)
            `, {
                        usernames: usersToNotify.map((user) => user.username),
                        notificationText: eventUpdateNotification.notificationText,
                    });
                    await notificationSession.close();
                }
            }
            return updatedEvent;
        }
        catch (error) {
            console.error("Error updating event:", error);
            throw new Error(`Failed to update event. ${error.message}`);
        }
        finally {
            await session.close();
        }
    };
};
export default getResolver;
