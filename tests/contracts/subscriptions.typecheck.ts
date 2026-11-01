// Compile-only negative fixtures: tsc must reject incomplete/mismatched targets.
import type { SubscriptionMutationResolvers } from "../../customResolvers/contracts/subscriptions.js";
import type { CommentSubscriptionTarget, DiscussionChannelSubscriptionTarget, EventSubscriptionTarget, EventUpdatesSubscriptionTarget, IssueSubscriptionTarget } from "../../services/persistence/subscriptionTargetRepository.js";
const identity = { id: "target", createdAt: "2026-01-01T00:00:00Z" };
const validComment: CommentSubscriptionTarget = { ...identity, text: null, SubscribedToNotifications: [] };
const validIssue: IssueSubscriptionTarget = { ...identity, issueNumber: 1, title: null, channelUniqueName: null, SubscribedToNotifications: [] };
const nullable: SubscriptionMutationResolvers["subscribeToComment"] = async () => undefined;
// @ts-expect-error subscriber list is required even when empty
const missingSubscribers: CommentSubscriptionTarget = { ...identity, text: null };
// @ts-expect-error discussion channel projection requires its discussion ID and channel
const missingDiscussion: DiscussionChannelSubscriptionTarget = { ...identity, archived: null, SubscribedToNotifications: [] };
// @ts-expect-error event title is non-null
const invalidEvent: EventSubscriptionTarget = { ...identity, title: null, description: null, SubscribedToNotifications: [] };
// @ts-expect-error event-update subscriptions use a different relationship field
const wrongRelationship: EventUpdatesSubscriptionTarget = { ...identity, title: "Event", SubscribedToNotifications: [] };
// @ts-expect-error issue numbers are serialized numbers, not database strings
const wrongIssueNumber: IssueSubscriptionTarget = { ...validIssue, issueNumber: "42" };
// @ts-expect-error generated argument boundary retains required eventId string
const wrongArgs: SubscriptionMutationResolvers["unsubscribeFromEvent"] = async (_parent, args: { eventId: number }) => null;
// @ts-expect-error notification subscribers cannot be substituted for event-update subscribers
const wrongResult: SubscriptionMutationResolvers["subscribeToEventUpdates"] = async () => ({ ...identity, title: "Event", SubscribedToNotifications: [] });
function projections(comment: CommentSubscriptionTarget, updates: EventUpdatesSubscriptionTarget) {
  // @ts-expect-error comment query never selects an event title
  void comment.title;
  // @ts-expect-error event-update query never selects description
  void updates.description;
}
void [validComment, validIssue, nullable, missingSubscribers, missingDiscussion, invalidEvent, wrongRelationship, wrongIssueNumber, wrongArgs, wrongResult, projections];
