import type { Driver, ManagedTransaction } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

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

export type EventRevision = { id: string; type: "title" | "description" };

export interface EventRevisionRepository {
  lockSnapshot(id: string, tx: ManagedTransaction): Promise<EventRevisionSnapshot | null>;
  recordChanges(snapshot: EventRevisionSnapshot, editor: string | null, tx: ManagedTransaction): Promise<EventRevision[]>;
  findSnapshot(id: string): Promise<EventRevisionSnapshot[]>;

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
export function createEventRevisionRepository(driver: Driver): EventRevisionRepository {
  return {
    async lockSnapshot(id, tx) {
      // Acquire the write lock BEFORE reading the preceding content. A second
      // editor must see the first editor's committed content, not a stale read.
      await tx.run(`MATCH (e:Event {id: $id}) SET e._revisionLock = true REMOVE e._revisionLock`, {id});
      const result = await executeGeneratedOperation<{events: EventRevisionSnapshot[]}>(driver, SNAPSHOT, {where: {id: {eq: id}}}, tx);
      return result.events[0] ?? null;
    },
    async recordChanges(snapshot, editor, tx) {
      const result = await tx.run(`
        MATCH (e:Event {id: $id})
        UNWIND [
          {kind: 'title', before: $title, after: e.title, author: $titleAuthor},
          {kind: 'description', before: $description, after: e.description, author: $descriptionAuthor}
        ] AS change
        WITH e, change WHERE NOT (change.before IS NULL AND change.after IS NULL)
          AND (change.before IS NULL OR change.after IS NULL OR change.before <> change.after)
        OPTIONAL MATCH (author:User {username: change.author})
        FOREACH (_ IN CASE WHEN change.kind = 'description' AND $editor IS NOT NULL THEN [1] ELSE [] END |
          SET e.ageGateTouchedAt = datetime())
        WITH e, change, author
        WHERE author IS NOT NULL
        CREATE (v:TextVersion {id: randomUUID(), body: coalesce(change.before, ''), createdAt: datetime(), ageGateTouchedAt: datetime()})
        CREATE (author)-[:AUTHORED_VERSION]->(v)
        FOREACH (_ IN CASE WHEN change.kind = 'title' THEN [1] ELSE [] END | CREATE (e)-[:HAS_TITLE_VERSION]->(v))
        FOREACH (_ IN CASE WHEN change.kind = 'description' THEN [1] ELSE [] END | CREATE (e)-[:HAS_DESCRIPTION_VERSION]->(v))
        RETURN v.id AS id, change.kind AS kind ORDER BY CASE change.kind WHEN 'title' THEN 0 ELSE 1 END`, {
        id: snapshot.id, title: snapshot.title ?? null, description: snapshot.description ?? null,
        titleAuthor: editor || snapshot.Poster?.username || null,
        descriptionAuthor: snapshot.DescriptionLastEditedBy?.username || snapshot.Poster?.username || '[Unknown]',
        editor,
      });
      // Attribution of the replaced description belongs to its prior editor;
      // only after recording it do we replace the current-editor relationship.
      await tx.run(`MATCH (e:Event {id: $id})
        WHERE $editor IS NOT NULL AND
          (($description IS NULL AND e.description IS NOT NULL) OR
           ($description IS NOT NULL AND e.description IS NULL) OR e.description <> $description)
        OPTIONAL MATCH (e)-[r:DESCRIPTION_LAST_EDITED_BY]->(:User)
        DELETE r
        WITH DISTINCT e
        OPTIONAL MATCH (u:User {username: $editor})
        FOREACH (_ IN CASE WHEN u IS NULL THEN [] ELSE [1] END | MERGE (e)-[:DESCRIPTION_LAST_EDITED_BY]->(u))`,
        {id: snapshot.id, description: snapshot.description ?? null, editor});
      return result.records.map(row => ({id: row.get('id'), type: row.get('kind')}));
    },
    async findSnapshot(id) {
      const result = await executeGeneratedOperation<{events: EventRevisionSnapshot[]}>(driver, SNAPSHOT, {where: {id: {eq: id}}});
      return result.events;
    },
  };
}
