import type {DetailSource,DetailChannel,DetailImage,DetailFile,DetailPreviewImage} from '../customResolvers/contracts/discussionDetailSources.js';
import type {RawCountConnection} from '../customResolvers/contracts/customCommentSources.js';
import {rememberCanonicalSource as remember} from './canonicalSourceFields.js';
import {canonicalChannelAnswer} from './customCommentSources.js';
function count(source:RawCountConnection){remember(source);remember(source.aggregate);remember(source.aggregate.count);}
export function canonicalDetailImage<T extends DetailPreviewImage>(source:T):T {
 remember(source);if(source.Uploader)remember(source.Uploader);return source;
}
export function canonicalDetailFile(source:DetailFile):DetailFile {
 remember(source);if(source.license)remember(source.license);return source;
}
export function canonicalDetailChannel(source:DetailChannel):DetailChannel {
 remember(source);remember(source.Channel);remember(source.Discussion);
 source.Flairs.forEach(remember);source.UpvotedByUsers.forEach(remember);source.SuperUpvotedByUsers.forEach(remember);
 count(source.UpvotedByUsersConnection);count(source.CommentsConnection);
 source.Answers.forEach(canonicalChannelAnswer);
 source.LabelOptions.forEach(option=>{remember(option);if(option.group)remember(option.group);});
 return source;
}
export function canonicalDiscussionDetail(source:DetailSource):DetailSource {
 remember(source);if(source.Author)remember(source.Author);
 if(source.Album){remember(source.Album);source.Album.Images.forEach(canonicalDetailImage<DetailImage>);}
 source.Tags.forEach(remember);source.FeedbackComments.forEach(remember);count(source.FeedbackCommentsConnection);
 source.DiscussionChannels.forEach(canonicalDetailChannel);source.DownloadableFiles.forEach(canonicalDetailFile);
 const cross=source.CrosspostedDiscussion;
 if(cross){
  remember(cross);if(cross.Author)remember(cross.Author);
  if(cross.Album){remember(cross.Album);cross.Album.Images.forEach(canonicalDetailImage);}
  cross.DiscussionChannels.forEach(channel=>{remember(channel);if(channel.Channel)remember(channel.Channel);});
 }
 const collection=source.SharedCollection;
 if(collection){remember(collection);if(collection.CreatedBy)remember(collection.CreatedBy);}
 return source;
}
