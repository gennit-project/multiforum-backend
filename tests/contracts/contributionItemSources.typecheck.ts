import type {UserContributionActivity,ChannelContributionActivity} from '../../customResolvers/contracts/contributionItemSources.js';
import type {UserContributionItemSource} from '../../customResolvers/contracts/contributionItemSelections.js';
import user from '../../customResolvers/queries/getUserContributions.js';
import type {Driver} from 'neo4j-driver';
declare const driver:Driver;
const actual=user({driver}) satisfies UserContributionItemSource;
declare const activity:UserContributionActivity;
const {WikiPage: _page,...withoutPage}=activity.WikiEdits[0];
// @ts-expect-error fixed wiki item cannot omit its selected nullable keys
const missingPage:UserContributionActivity={...activity,WikiEdits:[withoutPage]};
// @ts-expect-error selected actor source cannot omit username
const missingActor:UserContributionActivity={...activity,Comments:[{...activity.Comments[0],CommentAuthor:{profilePicURL:null}}]};
// @ts-expect-error raw property leaves are not certified scalar strings
const title:string=activity.Discussions[0].title;
// @ts-expect-error this query does not select protected email data
const email=activity.Events[0].Poster.Email;
// @ts-expect-error channel source does not collect event items
const inventedEvent:ChannelContributionActivity={...activity,Events:[activity.Events[0]]};
void[actual,_page,missingPage,missingActor,title,email,inventedEvent];
