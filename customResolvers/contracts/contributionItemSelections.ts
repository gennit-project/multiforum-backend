import type { Activity, QueryResolvers } from '../../src/generated/graphql.js';
import type { GraphQLContext } from '../../types/context.js';
import type { Selection } from './selection.js';
import type { RawSelectedResolver } from './rawSelectedSource.js';
const actor = { username: true, profilePicURL: true } as const;
const discussionChannel = { id: true, discussionId: true, channelUniqueName: true } as const;
const eventSummary = { id: true, title: true, createdAt: true } as const;
const comment = { id: true, text: true, createdAt: true, CommentAuthor: actor, Channel: { uniqueName: true }, DiscussionChannel: discussionChannel } as const;
const discussion = { id: true, title: true, createdAt: true, Author: actor, DiscussionChannels: discussionChannel } as const;
export const userContributionActivitySelection = {
  id: true, type: true, description: true, Comments: { ...comment, Event: eventSummary }, Discussions: discussion, Downloads: discussion,
  Events: { ...eventSummary, Poster: actor, EventChannels: { id: true, eventId: true, channelUniqueName: true } },
  WikiEdits: { id: true, body: true, editReason: true, createdAt: true, Author: actor, WikiPage: { id: true, title: true, slug: true, channelUniqueName: true } },
} as const satisfies Selection<Activity>;
export const channelContributionActivitySelection = { ...userContributionActivitySelection, Comments: comment } as const satisfies Selection<Activity>;
export type UserContributionItemSource = RawSelectedResolver<QueryResolvers<GraphQLContext>['getUserContributions'], {
  date: true; count: true; activities: typeof userContributionActivitySelection;
}>;
export type ChannelContributionItemSource = RawSelectedResolver<QueryResolvers<GraphQLContext>['getChannelContributions'], {
  username: true; displayName: true; profilePicURL: true; totalContributions: true;
  dayData: { date: true; count: true; activities: typeof channelContributionActivitySelection };
}>;
