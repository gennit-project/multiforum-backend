import type { Driver } from 'neo4j-driver';
import type { ModContributionActivity } from '../../customResolvers/contracts/modContributionItems.js';
import type { ModContributionItemSource } from '../../customResolvers/contracts/modContributionItemSelection.js';
import getMod from '../../customResolvers/queries/getModContributions.js';
declare const driver: Driver;
const actual = getMod({driver}) satisfies ModContributionItemSource;
declare const item: ModContributionActivity;
const { Issue: _issue, ...withoutIssue } = item;
// @ts-expect-error selected nullable keys cannot be omitted
const missing: ModContributionActivity = withoutIssue;
// @ts-expect-error issue projection must contain all selected keys
const shortIssue: ModContributionActivity = {...item, Issue: {id:'i'}};
// @ts-expect-error raw issue numbers are not completed numeric values
const number: number = item.Issue!.issueNumber;
// @ts-expect-error human author is deliberately not in this projection
const identity = item.RelatedDiscussion!.Author;
// @ts-expect-error fixed channel items cannot omit channelUniqueName
const shortEvent: ModContributionActivity = {...item, RelatedEvent: {id:'e',title:null,createdAt:null,EventChannels:[{id:'ec',eventId:'e'}]}};
void [actual,_issue,missing,shortIssue,number,identity,shortEvent];
