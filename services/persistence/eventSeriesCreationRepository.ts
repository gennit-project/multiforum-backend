import type {Driver, ManagedTransaction} from "neo4j-driver";
import type {EventSeriesCreateInput} from "../../src/generated/graphql.js";
import type {EventSeries} from "../../ogm_types.js";
import {executeGeneratedOperation} from "./generatedSchemaOperations.js";

export const CREATED_EVENT_SERIES_SELECTION = `
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

export interface EventSeriesCreationRepository {
  createWithinTransaction(input: EventSeriesCreateInput, tx: ManagedTransaction): Promise<EventSeries[]>;
  findCreatedSeries(id: string): Promise<EventSeries[]>;
}
export function createEventSeriesCreationRepository(driver: Driver): EventSeriesCreationRepository {
  return {
    async createWithinTransaction(input, tx) {
      const result = await executeGeneratedOperation<{createEventSeries: {eventSeries: EventSeries[]}}>(driver,
        `mutation CreateSeriesInTransaction($input: [EventSeriesCreateInput!]!) {
          createEventSeries(input: $input) {eventSeries ${CREATED_EVENT_SERIES_SELECTION}}
        }`, {input: [input]}, tx);
      return result.createEventSeries.eventSeries;
    },
    async findCreatedSeries(id) {
      const result = await executeGeneratedOperation<{eventSeries: EventSeries[]}>(driver,
        `query SeriesAfterCustomCreate($where: EventSeriesWhere) {eventSeries(where: $where) ${CREATED_EVENT_SERIES_SELECTION}}`, {where: {id: {eq: id}}});
      return result.eventSeries;
    },
  };
}
