import type { Driver, ManagedTransaction } from "neo4j-driver";
import type { EventCreateInput, EventWhere, EventUpdateInput } from "../../src/generated/graphql.js";
import type { Event } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { EVENT_REVISION_DEFAULT_SELECTION } from "./eventRevisionRepository.js";

export const CREATED_EVENT_SELECTION = `
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
export const EVENT_UPDATE_SNAPSHOT_SELECTION = `
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
        `;
export const UPDATED_EVENT_SELECTION = `
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

export interface EventWriteRepository {
  createWithinTransaction(input: EventCreateInput, tx: ManagedTransaction): Promise<Event[]>;
  findCreatedEvent(id: string): Promise<Event[]>;
  findUpdateSnapshot(where: EventWhere): Promise<Event[]>;
  updateWithinTransaction(where: EventWhere, update: EventUpdateInput, tx: ManagedTransaction): Promise<void>;
  findUpdatedEvent(id: string | undefined | null): Promise<Event[]>;
}

export function createEventWriteRepository(driver: Driver): EventWriteRepository {
  return {
    async createWithinTransaction(input, tx) {
      const result = await executeGeneratedOperation<{createEvents: {events: Event[]}}>(driver,
        `mutation CreateEventInTransaction($input: [EventCreateInput!]!) {
          createEvents(input: $input) { events ${CREATED_EVENT_SELECTION} }
        }`, {input: [input]}, tx);
      return result.createEvents.events;
    },
    async findCreatedEvent(id) {
      const result = await executeGeneratedOperation<{events: Event[]}>(driver,
        `query EventAfterCustomCreate($where: EventWhere) { events(where: $where) ${CREATED_EVENT_SELECTION} }`, {where: {id: {eq: id}}});
      return result.events;
    },
    async findUpdateSnapshot(where) {
      const result = await executeGeneratedOperation<{events: Event[]}>(driver,
        `query EventBeforeCustomUpdate($where: EventWhere) { events(where: $where) ${EVENT_UPDATE_SNAPSHOT_SELECTION} }`, {where});
      return result.events;
    },
    async updateWithinTransaction(where, update, tx) {
      await executeGeneratedOperation(driver,
        `mutation UpdateEventInTransaction($where: EventWhere, $update: EventUpdateInput) {
          updateEvents(where: $where, update: $update) { events ${EVENT_REVISION_DEFAULT_SELECTION} }
        }`, {where, update}, tx);
    },
    async findUpdatedEvent(id) {
      const result = await executeGeneratedOperation<{events: Event[]}>(driver,
        `query EventAfterCustomUpdate($where: EventWhere) { events(where: $where) ${UPDATED_EVENT_SELECTION} }`, {where: {id: {eq: id}}});
      return result.events;
    },
  };
}
