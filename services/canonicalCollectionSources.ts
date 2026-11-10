import type {ProfileCollectionProjection,PublicCollectionProjection} from '../customResolvers/contracts/accountProjections.js';
import {rememberCanonicalSource as remember} from './canonicalSourceFields.js';
/** These fixed internal documents have canonical keys and existing generated
 * selection contracts. Dynamic generated query results must not use this helper. */
export function canonicalProfileCollection(source:ProfileCollectionProjection):ProfileCollectionProjection {
 remember(source);
 source.Channels.forEach(remember);source.Discussions.forEach(remember);source.Comments.forEach(remember);
 source.Downloads.forEach(remember);source.Images.forEach(remember);
 return source;
}
export function canonicalPublicCollection(source:PublicCollectionProjection):PublicCollectionProjection {
 remember(source);if(source.CreatedBy)remember(source.CreatedBy);
 for(const download of source.Downloads){
  remember(download);if(download.Author)remember(download.Author);
  if(download.Album){remember(download.Album);download.Album.Images.forEach(remember);}
  download.Tags.forEach(remember);
  for(const channel of download.DiscussionChannels){
   remember(channel);if(channel.Channel)remember(channel.Channel);
   remember(channel.CommentsConnection);remember(channel.CommentsConnection.aggregate);remember(channel.CommentsConnection.aggregate.count);
  }
 }
 return source;
}
