import type { Integer } from "neo4j-driver";
/** COUNT/SIZE/REDUCE yield driver integers (or native numbers in configured
 * drivers); toString(date(...)) yields string/null, never persisted text. */
export type ContributionCount = Integer | number;
export type ContributionActivity = Record<string, unknown> & {
  type: "activity"; id: string | null; description: string | null;
};
export type ContributionDay = {
  date: string | null; count: ContributionCount; activities: ContributionActivity[];
};
export type UserContributionRow = ContributionDay;
export type ModContributionRow = {
  date: string | null; count: ContributionCount;
  activities: Array<Record<string, unknown> & {createdAt: string | null}>;
};
export type ChannelContributionRow = {
  username: unknown; displayName: unknown; profilePicURL: unknown;
  totalContributions: ContributionCount; dayData: ContributionDay[];
};
export type IssueCountRow = { totalCount: ContributionCount; issue: unknown };
