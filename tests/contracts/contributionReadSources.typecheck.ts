import type { Driver } from "neo4j-driver";
import type { ContributionReadQueryResolvers } from "../../customResolvers/contracts/contributionReadSources.js";
import type { ChannelContributionRow, ModContributionRow } from "../../customResolvers/contracts/contributionReadProjections.js";
import user from "../../customResolvers/queries/getUserContributions.js";
import mod from "../../customResolvers/queries/getModContributions.js";
import channel from "../../customResolvers/queries/getChannelContributions.js";
import issues from "../../customResolvers/queries/getSiteWideIssueList.js";
declare const driver: Driver;
const checked={getUserContributions:user({driver}),getModContributions:mod({driver}),getChannelContributions:channel({driver}),getSiteWideIssueList:issues({driver})} satisfies ContributionReadQueryResolvers;
// @ts-expect-error computed normalized count cannot be an arbitrary string
const badCount:ContributionReadQueryResolvers['getSiteWideIssueList']=()=>({aggregateIssueCount:'1'});
// @ts-expect-error contribution date must be narrowed before returning a non-null date
const badDate:ContributionReadQueryResolvers['getUserContributions']=()=>[{date:null,count:1,activities:[{type:'activity'}]}];
declare const channelRow:ChannelContributionRow;
// @ts-expect-error unselected username is a persisted unknown
const username:string=channelRow.username;
// @ts-expect-error dayData integer source has no normalized number guarantee
const nestedCount:number=channelRow.dayData[0].count;
declare const modRow:ModContributionRow;
// @ts-expect-error moderation action description is persisted and not certified
const description:string=modRow.activities[0].actionDescription;
void [checked,badCount,badDate,username,nestedCount,description];

import type { SiteWideIssueProjection } from '../../customResolvers/contracts/siteWideIssueProjection.js';
declare const issueItem: SiteWideIssueProjection;
const { updatedAt: omittedDate, ...incompleteIssue } = issueItem;
// @ts-expect-error even a nullable selected key must be present
const missingIssueKey: ContributionReadQueryResolvers['getSiteWideIssueList'] = () => ({aggregateIssueCount:0,issues:[incompleteIssue]});
// @ts-expect-error persisted title remains raw, not a completed String
const completedTitle: string = issueItem.title;
void [omittedDate,missingIssueKey,completedTitle];
