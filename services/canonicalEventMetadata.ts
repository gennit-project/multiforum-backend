import type {EventMetadataSource} from '../customResolvers/contracts/eventMetadataSource.js';
import {rememberCanonicalSource as remember} from './canonicalSourceFields.js';
/** Owned query maps only; do not mark Neo4j's native Point or alias projections. */
export function canonicalEventMetadata(source:EventMetadataSource):EventMetadataSource {
 remember(source);source.Tags.forEach(remember);
 source.SubscribedToNotifications.forEach(remember);source.SubscribedToEventUpdates.forEach(remember);
 if(source.Poster)remember(source.Poster);
 for(const entry of source.EventChannels){remember(entry);if(entry.Channel)remember(entry.Channel);}
 return source;
}
