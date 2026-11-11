import { rememberCanonicalSource } from "../../services/canonicalSourceFields.js";

type VoteSource = {
  id: string;
  weightedVotesCount: number;
  UpvotedByUsers: {username: string}[];
  UpvotedByUsersConnection: {totalCount: number; aggregate: {count: {nodes: number}}};
};
/** Computed vote maps and their fixed username projection retain their own keys.
 * This adds no identity or unselected relation data and changes no vote values. */
export function voteSource<T extends VoteSource>(source: T): T {
  for (const user of source.UpvotedByUsers) rememberCanonicalSource(user);
  rememberCanonicalSource(source.UpvotedByUsersConnection.aggregate.count);
  rememberCanonicalSource(source.UpvotedByUsersConnection.aggregate);
  rememberCanonicalSource(source.UpvotedByUsersConnection);
  return rememberCanonicalSource(source);
}
