import type {Event} from '../../src/generated/graphql.js';
import type {Selection,Projection} from './selection.js';
export const eventSeriesDeletionSelection={
 id:true,title:true,occurrenceIndex:true,
 EventSeries:{id:true,title:true,Occurrences:{id:true,occurrenceIndex:true}},
} as const satisfies Selection<Event>;
export type EventSeriesDeletionSnapshot=Projection<Event,typeof eventSeriesDeletionSelection>;
