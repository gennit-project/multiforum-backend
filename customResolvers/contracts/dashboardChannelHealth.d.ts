import type {ContributionCount} from './contributionReadProjections.js';
/** Fixed map: native channel leaves remain raw, counters are query expressions. */
export type DashboardChannelHealthProjection={
 id:unknown;
 channelUniqueName:unknown;
 displayName:unknown;
 channelIconURL:unknown;
 discussionCount:ContributionCount;
 commentCount:ContributionCount;
 eventCount:ContributionCount;
 downloadCount:ContributionCount;
 voteCount:ContributionCount;
 uniqueContributorCount:ContributionCount;
 openIssueCount:ContributionCount;
 issueOpenedCount:ContributionCount;
 moderationActionCount:ContributionCount;
 archivedContentCount:ContributionCount;
 lockedContentCount:ContributionCount;
 activityScore:ContributionCount;
 oldestOpenIssueAgeDays:ContributionCount|null;
 issuesPerHundredContributions:number;
};
