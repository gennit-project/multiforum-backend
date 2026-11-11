import type {SortedViewerChannel} from '../customResolvers/contracts/viewerReadProjections.js';
import {rememberCanonicalSource as remember} from './canonicalSourceFields.js';
/** Only the fixed owned sorted-channel projection, never generated alias maps. */
export function canonicalSortedChannel(source:SortedViewerChannel):SortedViewerChannel {
 remember(source);source.Tags.forEach(remember);
 for(const connection of [source.EventChannelsConnection,source.DiscussionChannelsConnection]){
  remember(connection);remember(connection.aggregate);remember(connection.aggregate.count);
 }
 return source;
}
