import type {EventSeriesDeletionSnapshot} from '../../customResolvers/contracts/eventSeriesDeletionProjection.js';
import type {Event} from '../../src/generated/graphql.js';
declare const snapshot:EventSeriesDeletionSnapshot;
// @ts-expect-error a deletion snapshot does not fetch a complete event
const full:Event=snapshot;
// @ts-expect-error series link remains nullable
void snapshot.EventSeries.Occurrences;
if(snapshot.EventSeries){
 // @ts-expect-error child occurrence does not select its title
 void snapshot.EventSeries.Occurrences[0].title;
 // @ts-expect-error selected nullable occurrence index must be present
 const occurrence:typeof snapshot.EventSeries.Occurrences[number]={id:'event'};
 void occurrence;
}
void full;
