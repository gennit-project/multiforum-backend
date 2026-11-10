import type { ContributionCount } from './contributionReadProjections.js';
/** toString(range date) and COUNT expressions, not persisted properties. */
export type DashboardTimeSeriesRow = {date:string;
 discussions:ContributionCount;
 comments:ContributionCount;
 events:ContributionCount;
 downloads:ContributionCount;
 issuesOpened:ContributionCount;
 moderationActions:ContributionCount;
};
