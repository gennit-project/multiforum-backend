import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { createTextVersion } from "./textVersionWrite.js";

export type EventRevisionSnapshot = {
  id?: string;
  title?: string | null;
  description?: string | null;
  Poster?: { username?: string | null } | null;
  DescriptionLastEditedBy?: { username?: string | null } | null;
  EventChannels?: Array<{ channelUniqueName?: string | null }> | null;
  PastTitleVersions?: Array<{ id?: string; body?: string | null; createdAt?: string | null }> | null;
  PastDescriptionVersions?: Array<{ id?: string; body?: string | null; createdAt?: string | null }> | null;
};

export interface EventRevisionRepository {
  findSnapshot(id: string): Promise<EventRevisionSnapshot[]>;
  findVersionAuthor(username: string): Promise<Array<{username: string}>>;
  createPreviousText(body: string, username: string): Promise<{textVersions: Array<{id: string}>}>;
  connectTitleVersion(id: string, versionId: string): Promise<void>;
  connectDescriptionVersion(id: string, versionId: string): Promise<void>;
  replaceDescriptionEditor(id: string, username: string): Promise<void>;
}
const SNAPSHOT = `query EventRevisionSnapshot($where: EventWhere!) {
 events(where: $where) {
          id
          title
          description
          Poster {
            username
          }
          DescriptionLastEditedBy {
            username
          }
          EventChannels {
            channelUniqueName
          }
          PastTitleVersions {
            id
            body
            createdAt
          }
          PastDescriptionVersions {
            id
            body
            createdAt
          }
        }
}`;
const AUTHOR = `query EventRevisionAuthor($where: UserWhere!) { users(where: $where) { username } }`;
// Preserve the production reused-schema OGM full defaults and post-commit projection failures.
export const EVENT_REVISION_DEFAULT_SELECTION = `{
  id
  title
  description
  editReason
  startTimeDayOfWeek
  startTimeHourOfDay
  locationName
  address
  virtualEventUrl
  placeId
  isInPrivateResidence
  cost
  free
  canceled
  deleted
  isHostedByOP
  isAllDay
  coverImageURL
  locked
  occurrenceIndex
  overrideSeriesTitle
  overrideSeriesDescription
  overrideSeriesLocation
  overrideSeriesCost
  variantUrls
  startTime
  endTime
  updatedAt
  createdAt
}`;
export const EVENT_TEXT_VERSION_DEFAULT_SELECTION = `{ id body editReason createdAt updatedAt }`;
const CONNECT_TITLE = `mutation ConnectPreviousEventTitle($where: EventWhere!, $update: EventUpdateInput!) {
 updateEvents(where: $where, update: $update) { events ${EVENT_REVISION_DEFAULT_SELECTION} }
}`;
const CONNECT_DESCRIPTION = `mutation ConnectPreviousEventDescription($where: EventWhere!, $update: EventUpdateInput!) {
 updateEvents(where: $where, update: $update) { events ${EVENT_REVISION_DEFAULT_SELECTION} }
}`;
const REPLACE_EDITOR = `mutation ReplaceEventDescriptionEditor($where: EventWhere!, $update: EventUpdateInput!) {
 updateEvents(where: $where, update: $update) { events ${EVENT_REVISION_DEFAULT_SELECTION} }
}`;
export function createEventRevisionRepository(driver: Driver): EventRevisionRepository {
  return {
    async findSnapshot(id) {
      const result = await executeGeneratedOperation<{events: EventRevisionSnapshot[]}>(driver, SNAPSHOT, {where: {id}});
      return result.events;
    },
    async findVersionAuthor(username) {
      const result = await executeGeneratedOperation<{users: Array<{username: string}>}>(driver, AUTHOR, {where: {username}});
      return result.users;
    },
    async createPreviousText(body, username) {
      return createTextVersion(driver, {body}, username);
    },
    async connectTitleVersion(id, versionId) {
      await executeGeneratedOperation(driver, CONNECT_TITLE, {where: {id}, update: {
        PastTitleVersions: {connect: [{where: {node: {id: versionId}}}]},
      }});
    },
    async connectDescriptionVersion(id, versionId) {
      await executeGeneratedOperation(driver, CONNECT_DESCRIPTION, {where: {id}, update: {
        PastDescriptionVersions: {connect: [{where: {node: {id: versionId}}}]},
      }});
    },
    async replaceDescriptionEditor(id, username) {
      await executeGeneratedOperation(driver, REPLACE_EDITOR, {where: {id}, update: {
        DescriptionLastEditedBy: {disconnect: {}, connect: {where: {node: {username}}}},
      }});
    },
  };
}
