import type { Integer } from 'neo4j-driver';
/** Fixed Cypher maps, not completed GraphQL objects. Persisted leaves remain raw. */
export type ContributionActor<Name = unknown> = { username: Name; profilePicURL: unknown };
export type ContributionDiscussionChannel = { id: unknown; discussionId: unknown; channelUniqueName: unknown };
export type ContributionEventChannel = { id: unknown; eventId: unknown; channelUniqueName: unknown };
export type ContributionEventSummary = { id: unknown; title: unknown; createdAt: string | null };
export type ContributionComment<Name = unknown> = {
  id: unknown; text: unknown; createdAt: string | null; CommentAuthor: ContributionActor<Name>;
  Channel: null; DiscussionChannel: ContributionDiscussionChannel | null;
};
export type ContributionDiscussion<Name = unknown> = {
  id: unknown; title: unknown; createdAt: string | null; Author: ContributionActor<Name>;
  DiscussionChannels: ContributionDiscussionChannel[];
};
export type UserContributionComment = ContributionComment<string> & { Event: ContributionEventSummary | null };
export type UserContributionDiscussion = ContributionDiscussion<string> & { hasDownload: unknown };
export type UserContributionEvent = ContributionEventSummary & { Poster: ContributionActor<string>; EventChannels: ContributionEventChannel[] };
export type UserContributionWikiEdit = {
  id: unknown; body: unknown; editReason: unknown; createdAt: string | null; Author: ContributionActor<string>;
  WikiPage: { id: unknown; title: unknown; slug: unknown; channelUniqueName: unknown };
};
type ActivityIdentity = { id: string | null; type: 'activity'; description: string | null };
export type UserContributionActivity = ActivityIdentity & {
  Comments: UserContributionComment[]; Discussions: UserContributionDiscussion[]; Downloads: UserContributionDiscussion[];
  Events: UserContributionEvent[]; WikiEdits: UserContributionWikiEdit[];
};
export type ChannelContributionActivity = ActivityIdentity & {
  Comments: ContributionComment[]; Discussions: ContributionDiscussion[];
  /** This query intentionally gathers discussions and comments only. */
  Downloads: []; Events: []; WikiEdits: [];
};
export type UserContributionDay = { date: string | null; count: Integer | number; activities: UserContributionActivity[] };
export type ChannelContributionDay = { date: string | null; count: Integer | number; activities: ChannelContributionActivity[] };
