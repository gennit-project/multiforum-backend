import type { Driver } from "neo4j-driver";
import type { ViewerReadQueryResolvers } from "../../customResolvers/contracts/viewerReadSources.js";
import type { ViewerComment, DiscussionViewerCore } from "../../customResolvers/contracts/viewerReadProjections.js";
import replies from "../../customResolvers/queries/getCommentReplies.js";
import section from "../../customResolvers/queries/getCommentSection.js";
import events from "../../customResolvers/queries/getEventComments.js";
import detail from "../../customResolvers/queries/getDiscussionDetail.js";
import discussions from "../../customResolvers/queries/getDiscussionsInChannel.js";
import channels from "../../customResolvers/queries/getSortedChannels.js";
declare const driver: Driver;
const checked = {
  getCommentReplies: replies({driver}), getCommentSection: section({driver}),
  getEventComments: events({driver}), getDiscussionDetail: detail({driver}),
  getDiscussionsInChannel: discussions({driver}), getSortedChannels: channels({driver}),
} satisfies ViewerReadQueryResolvers;
declare const rawComment: ViewerComment;
// @ts-expect-error arbitrary persisted comment text has not been proven
const text: string = rawComment.text;
// @ts-expect-error computed favorites cannot be arbitrary database values
const invalidFavorite: ViewerReadQueryResolvers["getSortedChannels"] = () => ({channels:[{isFavorited:"yes"}]});
// @ts-expect-error viewer identity requires a string from the matched request parameter
const invalidSubscriber: ViewerComment = {isFavoritedByUser:false,SubscribedToNotifications:[{username:null}]};
// @ts-expect-error parameter-matched discussion identity cannot be omitted
const invalidDiscussion: DiscussionViewerCore = {isFavorited:null};
// @ts-expect-error raw properties cannot replace the selected reply fields
const invalidReplies: ViewerReadQueryResolvers["getCommentReplies"] = () => ({ChildComments:[{}],aggregateChildCommentCount:0});
void [checked,text,invalidFavorite,invalidSubscriber,invalidDiscussion,invalidReplies];
