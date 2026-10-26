import type { Driver } from "neo4j-driver";
import { createEventChannelQuery } from "../cypher/cypherQueries.js";
import type { GraphQLContext } from "../../types/context.js";
import { createEventSeriesCreationRepository, type EventSeriesCreationRepository } from "../../services/persistence/eventSeriesCreationRepository.js";
import { logger } from "../../logger.js";
import { executeManagedWrite } from "../../services/neo4jTransactions.js";

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
  eventSeriesCreationRepository?: EventSeriesCreationRepository;
  driver: Driver;
};



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
  const { driver } = input;
  const repository = input.eventSeriesCreationRepository ?? createEventSeriesCreationRepository(driver);

  return async (parent: unknown, args: Args, context: GraphQLContext) => {
    const { input: seriesInput } = args;

    if (!seriesInput.channelConnections || seriesInput.channelConnections.length === 0) {
      throw new Error("At least one channel connection is required");
    }

    if (!seriesInput.occurrences || seriesInput.occurrences.length === 0) {
      throw new Error("At least one occurrence is required");
    }

    try {
      // Build the location point if coordinates provided
      const locationPoint = seriesInput.latitude && seriesInput.longitude
        ? { latitude: seriesInput.latitude, longitude: seriesInput.longitude }
        : undefined;

      // Tag texts and poster are wired as owned edges after the create (v7
      // dropped connectOrCreate / to-one connect from the create input).
      const tagTexts = seriesInput.tags ?? [];
      const posterUsername = context.user?.username;

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

      // Add repeat pattern if provided. RepeatPattern is its own node linked via
      // HAS_REPEAT_PATTERN, so create it nested rather than as a property.
      if (seriesInput.repeatPattern) {
        eventSeriesCreateInput.repeatPattern = {
          create: {
            node: {
              type: seriesInput.repeatPattern.type,
              count: seriesInput.repeatPattern.count,
              daysOfWeek: seriesInput.repeatPattern.daysOfWeek,
              endType: seriesInput.repeatPattern.endType,
              endCount: seriesInput.repeatPattern.endCount,
              endDate: seriesInput.repeatPattern.endDate,
            },
          },
        };
      }

      // v7 removed connectOrCreate (Tags) and to-one connect (Poster) from
      // create inputs; both the series and its occurrences get those edges via
      // owned MERGEs inside the create transaction below.

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
        }
      }));

      // Add occurrences to series
      eventSeriesCreateInput.Occurrences = {
        create: occurrenceInputs
      };

      const eventSeriesId = await executeManagedWrite(driver, async (transaction) => {
        // Create the series, its occurrences, and every EventChannel in one
        // retry-safe unit. If any channel link fails, none of the graph changes
        // from this attempt are committed.
        const created = await repository.createWithinTransaction(eventSeriesCreateInput, transaction);
        const newEventSeries = created[0];
        const occurrenceIds = newEventSeries.Occurrences.map((occurrence) => occurrence.id);

        // v7: own the Poster (POSTED_BY, direction IN) edge on the series and
        // every occurrence, replacing the removed to-one connect.
        if (posterUsername) {
          await transaction.run(
            `MATCH (u:User {username: $posterUsername})
             OPTIONAL MATCH (s:EventSeries {id: $seriesId})
             FOREACH (_ IN CASE WHEN s IS NULL THEN [] ELSE [1] END | MERGE (u)-[:POSTED_BY]->(s))
             WITH u
             UNWIND $occurrenceIds AS oid
             MATCH (e:Event {id: oid})
             MERGE (u)-[:POSTED_BY]->(e)`,
            { posterUsername, seriesId: newEventSeries.id, occurrenceIds }
          );
        }

        // v7: own the Tags (HAS_TAG, direction OUT) edges, replacing
        // connectOrCreate. Tag's only key is text, so MERGE by text.
        if (tagTexts.length > 0) {
          await transaction.run(
            `MATCH (s:EventSeries {id: $seriesId})
             UNWIND $tagTexts AS t
             MERGE (tag:Tag {text: t})
             MERGE (s)-[:HAS_TAG]->(tag)
             WITH tag, $occurrenceIds AS occurrenceIds
             UNWIND occurrenceIds AS oid
             MATCH (e:Event {id: oid})
             MERGE (e)-[:HAS_TAG]->(tag)`,
            { seriesId: newEventSeries.id, tagTexts, occurrenceIds }
          );
        }

        for (const occurrence of newEventSeries.Occurrences) {
          for (const channelUniqueName of seriesInput.channelConnections) {
            await transaction.run(createEventChannelQuery, {
              eventId: occurrence.id,
              channelUniqueName,
              poster: context.user?.username,
            });
          }
        }

        return newEventSeries.id;
      });

      // Refetch the EventSeries with all related data
      const fetchedEventSeries = await repository.findCreatedSeries(eventSeriesId);

      return fetchedEventSeries[0];
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Error creating event series:", message);
      throw new Error(`Failed to create event series: ${message}`);
    }
  };
};

export default getResolver;
