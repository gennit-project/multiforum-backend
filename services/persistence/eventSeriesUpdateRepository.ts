import type {Driver, ManagedTransaction} from "neo4j-driver";
import type {EventUpdateInput, EventSeriesUpdateInput} from "../../src/generated/graphql.js";
import type {Event} from "../../ogm_types.js";
import {executeGeneratedOperation} from "./generatedSchemaOperations.js";
import {EVENT_REVISION_DEFAULT_SELECTION} from "./eventRevisionRepository.js";
export const SERIES_OCCURRENCE_SNAPSHOT_SELECTION = `
          {
            id
            title
            startTime
            endTime
            locationName
            address
            virtualEventUrl
            canceled
            occurrenceIndex
            EventSeries {
              id
              title
              Occurrences {
                id
                occurrenceIndex
              }
            }
          }
        `;
export const UPDATED_SERIES_OCCURRENCE_SELECTION = `
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
          canceled
          cost
          isAllDay
          isHostedByOP
          coverImageURL
          occurrenceIndex
          Poster {
            username
          }
          EventSeries {
            id
            title
          }
          EventChannels {
            id
            channelUniqueName
            eventId
            Channel {
              uniqueName
            }
          }
          SubscribedToEventUpdates {
            username
            Email {
              address
            }
          }
          Tags {
            text
          }
          createdAt
          updatedAt
        }
      `;
export const EVENT_SERIES_DEFAULT_SELECTION = `{
  id
  title
  description
  locationName
  address
  virtualEventUrl
  placeId
  isInPrivateResidence
  cost
  free
  isHostedByOP
  coverImageURL
  canceled
  deleted
  variantUrls
  createdAt
  updatedAt
}`;
export interface EventSeriesUpdateRepository {
  findSnapshot(id: string): Promise<Event[]>;
  updateOccurrence(id: string, update: EventUpdateInput, tx: ManagedTransaction): Promise<void>;
  updateTemplate(id: string, update: EventSeriesUpdateInput, tx: ManagedTransaction): Promise<void>;
  findUpdatedOccurrence(id: string): Promise<Event[]>;
}
export function createEventSeriesUpdateRepository(driver: Driver): EventSeriesUpdateRepository {
  return {
    async findSnapshot(id) {
      const result = await executeGeneratedOperation<{events: Event[]}>(driver,
        `query SeriesOccurrenceBeforeUpdate($where: EventWhere) {events(where: $where) ${SERIES_OCCURRENCE_SNAPSHOT_SELECTION}}`, {where: {id}});
      return result.events;
    },
    async updateOccurrence(id, update, tx) {
      await executeGeneratedOperation(driver,
        `mutation UpdateSeriesOccurrence($where: EventWhere, $update: EventUpdateInput) {updateEvents(where: $where, update: $update) {events ${EVENT_REVISION_DEFAULT_SELECTION}}}`, {where: {id}, update}, tx);
    },
    async updateTemplate(id, update, tx) {
      await executeGeneratedOperation(driver,
        `mutation UpdateSeriesTemplate($where: EventSeriesWhere, $update: EventSeriesUpdateInput) {updateEventSeries(where: $where, update: $update) {eventSeries ${EVENT_SERIES_DEFAULT_SELECTION}}}`, {where: {id}, update}, tx);
    },
    async findUpdatedOccurrence(id) {
      const result = await executeGeneratedOperation<{events: Event[]}>(driver,
        `query SeriesOccurrenceAfterUpdate($where: EventWhere) {events(where: $where) ${UPDATED_SERIES_OCCURRENCE_SELECTION}}`, {where: {id}});
      return result.events;
    },
  };
}
