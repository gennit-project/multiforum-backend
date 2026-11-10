import type { Integer } from 'neo4j-driver';
import type { ContributionDiscussionChannel, ContributionEventChannel, ContributionEventSummary } from './contributionItemSources.js';
/** Explicit maps shared by action and feedback branches of the owned query. */
export type ModContributionComment = { id: unknown; text: unknown; createdAt: string | null };
export type ModContributionEvent = ContributionEventSummary & { EventChannels: ContributionEventChannel[] };
export type ModContributionDiscussion = { id: unknown; title: unknown; createdAt: string | null; DiscussionChannels: ContributionDiscussionChannel[] };
export type ModContributionIssue = {
  id: unknown; issueNumber: unknown; channelUniqueName: unknown;
  relatedDiscussionId: unknown; relatedEventId: unknown; relatedCommentId: unknown;
  title: unknown; isOpen: unknown;
};
export type ModContributionActivity = {
  id: unknown; actionType: unknown; actionDescription: unknown; createdAt: string | null;
  Comment: ModContributionComment | null;
  Issue: ModContributionIssue | null;
  RelatedDiscussion: ModContributionDiscussion | null;
  RelatedEvent: ModContributionEvent | null;
  RelatedComment: (ModContributionComment & {
    DiscussionChannel: ContributionDiscussionChannel | null; Event: ModContributionEvent | null;
  }) | null;
};
export type ModContributionDay = { date: string | null; count: Integer | number; activities: ModContributionActivity[] };
