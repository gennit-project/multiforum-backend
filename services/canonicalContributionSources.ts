import type {
  ContributionActor, ContributionComment, ContributionDiscussion,
  UserContributionActivity, UserContributionDay, ChannelContributionDay,
} from '../customResolvers/contracts/contributionItemSources.js';
import type { ChannelContributionRow } from '../customResolvers/contracts/contributionReadProjections.js';
import { rememberCanonicalSource } from './canonicalSourceFields.js';
import { rememberAccountChildIdentity } from './accountChildIdentity.js';

function mark<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) rememberCanonicalSource(value);
  return value;
}
function each<T>(values: readonly T[] | undefined, apply: (value: T) => unknown) {
  if (Array.isArray(values)) { const items: readonly T[] = values; items.forEach(apply); }
}
function actor(value: ContributionActor | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  mark(value);
  rememberAccountChildIdentity(value, value.username);
}
function comment<T extends ContributionComment>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  mark(value); actor(value.CommentAuthor); mark(value.DiscussionChannel);
  return value;
}
function discussion<T extends ContributionDiscussion>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  mark(value); actor(value.Author); each(value.DiscussionChannels, mark);
  return value;
}
function userActivity(value: UserContributionActivity) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  mark(value);
  each(value.Comments, item => { comment(item); mark(item?.Event); });
  each(value.Discussions, discussion); each(value.Downloads, discussion);
  each(value.Events, item => { mark(item); if (item) { actor(item.Poster); each(item.EventChannels, mark); } });
  each(value.WikiEdits, item => { mark(item); if (item) { actor(item.Author); mark(item.WikiPage); } });
}
/** Only owned query maps receive metadata. Raw leaves remain GraphQL-completed;
 * no eager validation or extra reads are introduced for unrequested fields. */
export function canonicalUserContributionDay<T extends UserContributionDay>(value: T): T {
  mark(value); each(value.activities, userActivity);
  return value;
}
function channelDay(value: ChannelContributionDay) {
  mark(value);
  each(value.activities, activity => {
    mark(activity); if (!activity) return;
    each(activity.Comments, comment); each(activity.Discussions, discussion);
  });
}
export function canonicalChannelContribution<T extends ChannelContributionRow>(value: T): T {
  mark(value); each(value.dayData, channelDay);
  return value;
}
