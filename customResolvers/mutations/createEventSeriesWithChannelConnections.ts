import type { Driver } from "neo4j-driver";
import { createEventChannelQuery } from "../cypher/cypherQueries.js";
import type { GraphQLContext } from "../../types/context.js";
import type { EventSeriesModel, EventModel, TagModel } from "../../ogm_types.js";
import { logger } from "../../logger.js";

type DateOccurrence = {
  startTime: string;
  endTime: string;
};

type RepeatPatternInput = {
  type: 'MANUAL' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  count?: number;
  daysOfWeek?: number[];
  endType: 'NEVER' | 'AFTER_COUNT' | 'ON_DATE';
  endCount?: number;
  endDate?: string;
};

type EventSeriesCreateInput = {
  title: string;
  description?: string;
  locationName?: string;
  address?: string;
  virtualEventUrl?: string;
  placeId?: string;
  isInPrivateResidence?: boolean;
  cost?: string;
  free?: boolean;
  latitude?: number;
  longitude?: number;
  isHostedByOP?: boolean;
  isAllDay?: boolean;
  coverImageURL?: string;
  tags?: string[];
  channelConnections: string[];
  occurrences: DateOccurrence[];
  repeatPattern?: RepeatPatternInput;
};

type Args = {
  input: EventSeriesCreateInput;
};

type Input = {
  EventSeries: EventSeriesModel;
  Event: EventModel;
  Tag: TagModel;
  driver: Driver;
};

const eventSeriesSelectionSet = `
  {
    id
    title
    description
    locationName
    address
    virtualEventUrl
    cost
    free
    isHostedByOP
    coverImageURL
    canceled
    createdAt
    updatedAt
    repeatPattern {
      type
      count
      daysOfWeek
      endType
      endCount
      endDate
    }
    Poster {
      username
    }
    Tags {
      text
    }
    Occurrences {
      id
      title
      startTime
      endTime
      canceled
      occurrenceIndex
      EventChannels {
        id
        channelUniqueName
        Channel {
          uniqueName
        }
      }
    }
    EventChannels {
      id
      channelUniqueName
      Channel {
        uniqueName
      }
    }
  }
`;

const eventSelectionSet = `
  {
    id
    title
    description
    startTime
    endTime
    locationName
    address
    virtualEventUrl
    cost
    free
    canceled
    isAllDay
    isHostedByOP
    coverImageURL
    occurrenceIndex
    createdAt
    updatedAt
    Poster {
      username
    }
    Tags {
      text
    }
    EventChannels {
      id
      channelUniqueName
      Channel {
        uniqueName
      }
    }
  }
`;

/**
 * Helper to get the day of week from an ISO date string
 */
const getDayOfWeek = (isoDateString: string): string => {
  const date = new Date(isoDateString);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[date.getUTCDay()];
};

/**
 * Helper to get the hour of day from an ISO date string
 */
const getHourOfDay = (isoDateString: string): number => {
  const date = new Date(isoDateString);
  return date.getUTCHours();
};

/**
 * Main resolver for creating an event series with occurrences
 */
const getResolver = (input: Input) => {
  const { EventSeries, Event, Tag, driver } = input;

  return async (parent: unknown, args: Args, context: GraphQLContext) => {
    const { input: seriesInput } = args;

    if (!seriesInput.channelConnections || seriesInput.channelConnections.length === 0) {
      throw new Error("At least one channel connection is required");
    }

    if (!seriesInput.occurrences || seriesInput.occurrences.length === 0) {
      throw new Error("At least one occurrence is required");
    }

    const session = driver.session();

    try {
      // Build the location point if coordinates provided
      const locationPoint = seriesInput.latitude && seriesInput.longitude
        ? { latitude: seriesInput.latitude, longitude: seriesInput.longitude }
        : undefined;

      // Build tag connections if tags provided
      const tagConnections = seriesInput.tags?.length
        ? seriesInput.tags.map(tagText => ({
            where: { node: { text: tagText } },
            onCreate: { node: { text: tagText } }
          }))
        : [];

      // Build poster connection
      const posterConnection = context.user?.username
        ? {
            connect: {
              where: { node: { username: context.user.username } }
            }
          }
        : undefined;

      // Create the EventSeries node
      const eventSeriesCreateInput: any = {
        title: seriesInput.title,
        description: seriesInput.description || '',
        locationName: seriesInput.locationName,
        address: seriesInput.address,
        virtualEventUrl: seriesInput.virtualEventUrl,
        placeId: seriesInput.placeId,
        isInPrivateResidence: seriesInput.isInPrivateResidence,
        cost: seriesInput.cost,
        free: seriesInput.free ?? true,
        isHostedByOP: seriesInput.isHostedByOP ?? false,
        coverImageURL: seriesInput.coverImageURL,
        canceled: false,
        deleted: false,
      };

      // Add location point if available
      if (locationPoint) {
        eventSeriesCreateInput.location = locationPoint;
      }

      // Add repeat pattern if provided
      if (seriesInput.repeatPattern) {
        eventSeriesCreateInput.repeatPattern = {
          type: seriesInput.repeatPattern.type,
          count: seriesInput.repeatPattern.count,
          daysOfWeek: seriesInput.repeatPattern.daysOfWeek,
          endType: seriesInput.repeatPattern.endType,
          endCount: seriesInput.repeatPattern.endCount,
          endDate: seriesInput.repeatPattern.endDate,
        };
      }

      // Add tag connections
      if (tagConnections.length > 0) {
        eventSeriesCreateInput.Tags = {
          connectOrCreate: tagConnections
        };
      }

      // Add poster connection
      if (posterConnection) {
        eventSeriesCreateInput.Poster = posterConnection;
      }

      // Create event occurrences
      const occurrenceInputs = seriesInput.occurrences.map((occ, index) => ({
        node: {
          title: seriesInput.title,
          description: seriesInput.description || '',
          startTime: occ.startTime,
          startTimeDayOfWeek: getDayOfWeek(occ.startTime),
          startTimeHourOfDay: getHourOfDay(occ.startTime),
          endTime: occ.endTime,
          locationName: seriesInput.locationName,
          address: seriesInput.address,
          virtualEventUrl: seriesInput.virtualEventUrl,
          placeId: seriesInput.placeId,
          isInPrivateResidence: seriesInput.isInPrivateResidence,
          cost: seriesInput.cost,
          free: seriesInput.free ?? true,
          isHostedByOP: seriesInput.isHostedByOP ?? false,
          isAllDay: seriesInput.isAllDay ?? false,
          coverImageURL: seriesInput.coverImageURL,
          canceled: false,
          deleted: false,
          occurrenceIndex: index,
          ...(locationPoint ? { location: locationPoint } : {}),
          ...(tagConnections.length > 0 ? { Tags: { connectOrCreate: tagConnections } } : {}),
          ...(posterConnection ? { Poster: posterConnection } : {}),
        }
      }));

      // Add occurrences to series
      eventSeriesCreateInput.Occurrences = {
        create: occurrenceInputs
      };

      // Create the EventSeries with all occurrences
      const createResult = await EventSeries.create({
        input: [eventSeriesCreateInput],
        selectionSet: `{ eventSeries ${eventSeriesSelectionSet} }`,
      });

      const newEventSeries = createResult.eventSeries[0];
      const eventSeriesId = newEventSeries.id;

      // Link each occurrence to channels via EventChannel
      for (const occurrence of newEventSeries.Occurrences) {
        for (const channelUniqueName of seriesInput.channelConnections) {
          try {
            await session.run(createEventChannelQuery, {
              eventId: occurrence.id,
              channelUniqueName,
              poster: context.user?.username,
            });
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("Constraint validation failed")) {
              logger.warn(`Skipping duplicate EventChannel: ${channelUniqueName}`);
              continue;
            } else {
              throw error;
            }
          }
        }
      }

      // Refetch the EventSeries with all related data
      const fetchedEventSeries = await EventSeries.find({
        where: {
          id: eventSeriesId,
        },
        selectionSet: eventSeriesSelectionSet,
      });

      return fetchedEventSeries[0];
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Error creating event series:", message);
      throw new Error(`Failed to create event series: ${message}`);
    } finally {
      session.close();
    }
  };
};

export default getResolver;
