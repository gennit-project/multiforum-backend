import type { MutationResolvers, Comment, DiscussionChannel, Event, Issue } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { Selection, SelectedResolver } from "./selection.js";

export const commentSubscriptionSelection = { id: true, text: true, createdAt: true, SubscribedToNotifications: { username: true } } as const satisfies Selection<Comment>;
export const discussionChannelSubscriptionSelection = { id: true, discussionId: true, channelUniqueName: true, createdAt: true, archived: true, SubscribedToNotifications: { username: true } } as const satisfies Selection<DiscussionChannel>;
export const eventSubscriptionSelection = { id: true, title: true, description: true, createdAt: true, SubscribedToNotifications: { username: true } } as const satisfies Selection<Event>;
export const eventUpdatesSubscriptionSelection = { id: true, title: true, createdAt: true, SubscribedToEventUpdates: { username: true } } as const satisfies Selection<Event>;
export const issueSubscriptionSelection = { id: true, issueNumber: true, title: true, channelUniqueName: true, createdAt: true, SubscribedToNotifications: { username: true } } as const satisfies Selection<Issue>;

export const subscriptionMutationNames = ["subscribeToComment", "unsubscribeFromComment", "subscribeToDiscussionChannel", "unsubscribeFromDiscussionChannel", "subscribeToEvent", "unsubscribeFromEvent", "subscribeToEventUpdates", "unsubscribeFromEventUpdates", "subscribeToIssue", "unsubscribeFromIssue"] as const;
export type SubscriptionMutationName = typeof subscriptionMutationNames[number];
export type SubscriptionMutationResolvers = {
  subscribeToComment: SelectedResolver<MutationResolvers<GraphQLContext>["subscribeToComment"], typeof commentSubscriptionSelection>;
  unsubscribeFromComment: SelectedResolver<MutationResolvers<GraphQLContext>["unsubscribeFromComment"], typeof commentSubscriptionSelection>;
  subscribeToDiscussionChannel: SelectedResolver<MutationResolvers<GraphQLContext>["subscribeToDiscussionChannel"], typeof discussionChannelSubscriptionSelection>;
  unsubscribeFromDiscussionChannel: SelectedResolver<MutationResolvers<GraphQLContext>["unsubscribeFromDiscussionChannel"], typeof discussionChannelSubscriptionSelection>;
  subscribeToEvent: SelectedResolver<MutationResolvers<GraphQLContext>["subscribeToEvent"], typeof eventSubscriptionSelection>;
  unsubscribeFromEvent: SelectedResolver<MutationResolvers<GraphQLContext>["unsubscribeFromEvent"], typeof eventSubscriptionSelection>;
  subscribeToEventUpdates: SelectedResolver<MutationResolvers<GraphQLContext>["subscribeToEventUpdates"], typeof eventUpdatesSubscriptionSelection>;
  unsubscribeFromEventUpdates: SelectedResolver<MutationResolvers<GraphQLContext>["unsubscribeFromEventUpdates"], typeof eventUpdatesSubscriptionSelection>;
  subscribeToIssue: SelectedResolver<MutationResolvers<GraphQLContext>["subscribeToIssue"], typeof issueSubscriptionSelection>;
  unsubscribeFromIssue: SelectedResolver<MutationResolvers<GraphQLContext>["unsubscribeFromIssue"], typeof issueSubscriptionSelection>;
};
