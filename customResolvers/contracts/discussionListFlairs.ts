import type { DiscussionFlair, DiscussionChannelListItemResolvers } from '../../src/generated/graphql.js';
import type { GraphQLContext } from '../../types/context.js';
import type { Selection } from './selection.js';
import type { RawSelectedSource, RawSelectedListResolver } from './rawSelectedSource.js';

export const discussionListFlairSelection = {
  id:true, channelUniqueName:true, displayName:true, color:true, order:true, archived:true,
} as const satisfies Selection<DiscussionFlair>;
export type DiscussionListFlairFields = RawSelectedSource<DiscussionFlair, typeof discussionListFlairSelection>;
// The actual Cypher map always includes color, even when its value is null.
export type DiscussionListFlair = DiscussionListFlairFields & {readonly color: unknown};
export type DiscussionListFlairSource = RawSelectedListResolver<
  DiscussionChannelListItemResolvers<GraphQLContext>['Flairs'], typeof discussionListFlairSelection>;
