import type {SiteWideDiscussionSource} from '../customResolvers/contracts/siteWideDiscussionSources.js';
import {rememberCanonicalSource as remember} from './canonicalSourceFields.js';
/** Only call on the exact owned hydration map, never a generated alias projection. */
export function canonicalSiteWideDiscussion(source:SiteWideDiscussionSource):SiteWideDiscussionSource {
 remember(source);
 if(source.Author) remember(source.Author);
 if(source.Album) {
  remember(source.Album);
  source.Album.Images.forEach(remember);
 }
 source.Tags.forEach(remember);
 source.DownloadableFiles.forEach(remember);
 for(const channel of source.DiscussionChannels) {
  remember(channel);remember(channel.Channel);
  channel.Flairs.forEach(remember);
  channel.UpvotedByUsers.forEach(remember);
  channel.SuperUpvotedByUsers.forEach(remember);
  remember(channel.CommentsConnection);
  remember(channel.CommentsConnection.aggregate);
  remember(channel.CommentsConnection.aggregate.count);
 }
 return source;
}
