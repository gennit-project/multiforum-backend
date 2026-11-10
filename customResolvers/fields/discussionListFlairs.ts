import type { DiscussionListFlairFields } from '../contracts/discussionListFlairs.js';

/** Only the owned discussion-list hydration query produces this custom parent.
 * Keep raw scalar values untouched for GraphQL's lazy child completion.
 */
export function discussionListFlairs(parent: {Flairs?: (DiscussionListFlairFields | null)[] | null} | null | undefined): DiscussionListFlairFields[] {
  const value = parent?.Flairs;
  return Array.isArray(value) ? value.filter(item => item !== null) : [];
}
