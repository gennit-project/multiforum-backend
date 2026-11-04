import type { QueryResolvers } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { SelectedResolver } from "./selection.js";
export const viewerCommentSelection = { isFavoritedByUser: true, SubscribedToNotifications: { username: true } } as const;
export const viewerReadQueryNames = ["getCommentReplies","getCommentSection","getEventComments","getDiscussionDetail","getDiscussionsInChannel","getSortedChannels"] as const;
export type ViewerReadQueryResolvers = {
  getCommentReplies: SelectedResolver<QueryResolvers<GraphQLContext>["getCommentReplies"], { ChildComments: typeof viewerCommentSelection & { ParentComment: { id: true } }; aggregateChildCommentCount: true }>;
  getCommentSection: SelectedResolver<QueryResolvers<GraphQLContext>["getCommentSection"], {
    DiscussionChannel: { discussionId:true; channelUniqueName:true; SubscribedToNotifications:{username:true}; Channel:{uniqueName:true}; Discussion:{id:true} };
    Comments: typeof viewerCommentSelection;
  }>;
  getEventComments: SelectedResolver<QueryResolvers<GraphQLContext>["getEventComments"], {
    Event:{id:true;SubscribedToNotifications:{username:true};SubscribedToEventUpdates:{username:true}};
    Comments:typeof viewerCommentSelection;
  }>;
  getDiscussionDetail: SelectedResolver<QueryResolvers<GraphQLContext>["getDiscussionDetail"], {
    id:true;isFavorited:true;DiscussionChannels:{discussionId:true;channelUniqueName:true;UpvotedByUsers:{username:true};SuperUpvotedByUsers:{username:true}};
  }>;
  getDiscussionsInChannel: SelectedResolver<QueryResolvers<GraphQLContext>["getDiscussionsInChannel"], {
    discussionChannels:{UpvotedByUsers:{username:true};SuperUpvotedByUsers:{username:true};isFavorited:true;Discussion:{authorIsChannelModerator:true}};
  }>;
  getSortedChannels: SelectedResolver<QueryResolvers<GraphQLContext>["getSortedChannels"], {channels:{isFavorited:true}}>;
};
