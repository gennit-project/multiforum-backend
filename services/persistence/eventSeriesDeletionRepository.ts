import type {Driver} from "neo4j-driver";
import type {EventSeriesDeletionSnapshot} from "../../customResolvers/contracts/eventSeriesDeletionProjection.js";
import {executeGeneratedOperation} from "./generatedSchemaOperations.js";
export const SERIES_DELETION_SNAPSHOT_SELECTION = `
          {
            id
            title
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
export interface EventSeriesDeletionRepository {
  findSnapshot(id: string): Promise<EventSeriesDeletionSnapshot[]>;
  deleteOccurrence(id: string): Promise<void>;
  deleteTemplate(id: string): Promise<void>;
}
export function createEventSeriesDeletionRepository(driver: Driver): EventSeriesDeletionRepository {
  return {
    async findSnapshot(id) {
      const result=await executeGeneratedOperation<{events: EventSeriesDeletionSnapshot[]}>(driver,
        `query SeriesBeforeScopedDeletion($where: EventWhere) {events(where: $where) ${SERIES_DELETION_SNAPSHOT_SELECTION}}`, {where: {id: {eq: id}}});
      return result.events;
    },
    async deleteOccurrence(id) {
      await executeGeneratedOperation(driver,
        `mutation DeleteSeriesOccurrence($where: EventWhere) {deleteEvents(where: $where) {nodesDeleted relationshipsDeleted}}`, {where: {id: {eq: id}}});
    },
    async deleteTemplate(id) {
      await executeGeneratedOperation(driver,
        `mutation DeleteSeriesTemplate($where: EventSeriesWhere) {deleteEventSeries(where: $where) {nodesDeleted relationshipsDeleted}}`, {where: {id: {eq: id}}});
    },
  };
}
