import type { ModActivity, QueryResolvers } from '../../src/generated/graphql.js';
import type { GraphQLContext } from '../../types/context.js';
import type { Selection } from './selection.js';
import type { RawSelectedResolver } from './rawSelectedSource.js';
const comment = { id: true, text: true, createdAt: true } as const;
const discussionChannel = { id: true, channelUniqueName: true, discussionId: true } as const;
const event = { id: true, title: true, createdAt: true, EventChannels: { id: true, channelUniqueName: true, eventId: true } } as const;
export const modContributionItemSelection = {
  id: true, actionType: true, actionDescription: true, createdAt: true,
  Comment: comment,
  Issue: { id: true, issueNumber: true, channelUniqueName: true, relatedDiscussionId: true, relatedEventId: true, relatedCommentId: true, title: true, isOpen: true },
  RelatedDiscussion: { id: true, title: true, createdAt: true, DiscussionChannels: discussionChannel },
  RelatedEvent: event,
  RelatedComment: { ...comment, DiscussionChannel: discussionChannel, Event: event },
} as const satisfies Selection<ModActivity>;
export type ModContributionItemSource = RawSelectedResolver<QueryResolvers<GraphQLContext>['getModContributions'], {
  date: true; count: true; activities: typeof modContributionItemSelection;
}>;
