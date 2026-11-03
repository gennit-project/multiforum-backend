import type { CreatedEventSeriesProjection } from "../../customResolvers/contracts/contentProjections.js";
import type {Driver, ManagedTransaction} from "neo4j-driver";
import type {EventSeriesCreateInput} from "../../src/generated/graphql.js";
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
  createWithinTransaction(input: EventSeriesCreateInput, tx: ManagedTransaction): Promise<CreatedEventSeriesProjection[]>;
  findCreatedSeries(id: string): Promise<CreatedEventSeriesProjection[]>;
}
export function createEventSeriesCreationRepository(driver: Driver): EventSeriesCreationRepository {
  return {
    async createWithinTransaction(input, tx) {
      const result = await executeGeneratedOperation<{createEventSeries: {eventSeries: CreatedEventSeriesProjection[]}}>(driver,
        `mutation CreateSeriesInTransaction($input: [EventSeriesCreateInput!]!) {
          createEventSeries(input: $input) {eventSeries ${CREATED_EVENT_SERIES_SELECTION}}
        }`, {input: [input]}, tx);
      return result.createEventSeries.eventSeries;
    },
    async findCreatedSeries(id) {
      const result = await executeGeneratedOperation<{eventSeries: CreatedEventSeriesProjection[]}>(driver,
        `query SeriesAfterCustomCreate($where: EventSeriesWhere) {eventSeries(where: $where) ${CREATED_EVENT_SERIES_SELECTION}}`, {where: {id: {eq: id}}});
      return result.eventSeries;
    },
  };
}
