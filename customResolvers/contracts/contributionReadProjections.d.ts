import type { ModContributionDay } from './modContributionItems.js';
import type { ChannelContributionActivity, ChannelContributionDay, UserContributionDay } from './contributionItemSources.js';
import type { Integer } from "neo4j-driver";
/** COUNT/SIZE/REDUCE yield driver integers (or native numbers in configured
 * drivers); toString(date(...)) yields string/null, never persisted text. */
export type ContributionCount = Integer | number;
export type ContributionActivity = ChannelContributionActivity;
export type ContributionDay = ChannelContributionDay;
export type UserContributionRow = UserContributionDay;
export type ModContributionRow = ModContributionDay;
export type ChannelContributionRow = {
  username: unknown; displayName: unknown; profilePicURL: unknown;
  totalContributions: ContributionCount; dayData: ContributionDay[];
};
export type IssueCountRow = { totalCount: ContributionCount; issue: unknown };
