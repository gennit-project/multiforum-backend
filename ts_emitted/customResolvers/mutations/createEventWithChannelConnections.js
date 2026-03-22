import { createEventChannelQuery } from "../cypher/cypherQueries.js";
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
      createdAt
      channelUniqueName
      eventId
      archived
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
    }
    createdAt
    updatedAt
    Tags {
      text
    }
  }
`;
/**
 * Function to create events from an input array.
 */
export const createEventsFromInput = async (Event, driver, input, context) => {
    var _a;
    if (!input || input.length === 0) {
        throw new Error("Input cannot be empty");
    }
    const session = driver.session();
    const events = [];
    try {
        for (const { eventCreateInput, channelConnections } of input) {
            if (!channelConnections || channelConnections.length === 0) {
                console.warn("Skipping event creation: No channels provided");
                continue;
            }
            try {
                const response = await Event.create({
                    input: [eventCreateInput],
                    selectionSet: `{ events ${selectionSet} }`,
                });
                const newEvent = response.events[0];
                const newEventId = newEvent.id;
                // Link the event to channels
                for (const channelUniqueName of channelConnections) {
                    try {
                        await session.run(createEventChannelQuery, {
                            eventId: newEventId,
                            channelUniqueName,
                            poster: (_a = context.user) === null || _a === void 0 ? void 0 : _a.username,
                        });
                    }
                    catch (error) {
                        if (error.message.includes("Constraint validation failed")) {
                            console.warn(`Skipping duplicate EventChannel: ${channelUniqueName}`);
                            continue;
                        }
                        else {
                            throw error;
                        }
                    }
                }
                // Refetch the event with all related data
                const fetchedEvent = await Event.find({
                    where: {
                        id: newEventId,
                    },
                    selectionSet,
                });
                events.push(fetchedEvent[0]);
            }
            catch (error) {
                console.warn("Event creation error details:", {
                    message: error.message,
                    code: error.code,
                    details: error.stack,
                    neo4jError: error.neo4jError,
                    fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
                });
                if (error.message.includes("Constraint validation failed")) {
                    console.warn("Constraint validation details:");
                    console.log('Input:', JSON.stringify(eventCreateInput, null, 2));
                    continue;
                }
            }
        }
    }
    catch (error) {
        console.error("Unexpected error during event creation:", error.message);
    }
    finally {
        session.close();
    }
    return events;
};
/**
 * Main resolver that uses createEventsFromInput
 */
const getResolver = (input) => {
    const { Event, driver } = input;
    return async (parent, args, context, info) => {
        const { input } = args;
        try {
            // Use the extracted function to create events
            const events = await createEventsFromInput(Event, driver, input, context);
            return events;
        }
        catch (error) {
            console.error(error);
            throw new Error(`An error occurred while creating events: ${error.message}`);
        }
    };
};
export default getResolver;
