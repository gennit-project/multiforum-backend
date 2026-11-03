import { moderationMutationNames } from "./moderation.js";
import { votingMutationNames } from "./voting.js";
import { subscriptionMutationNames } from "./subscriptions.js";
import { reactionMutationNames } from "./reactions.js";

// Checked maps identify the actual composition variables, not parallel examples.
export const checkedRootGroups = [
  ["Mutation", "votingResolvers", "VotingMutationResolvers", votingMutationNames],
  ["Mutation", "subscriptionResolvers", "SubscriptionMutationResolvers", subscriptionMutationNames],
  ["Mutation", "reactionResolvers", "ReactionMutationResolvers", reactionMutationNames],
  ["Mutation", "moderationResolvers", "ModerationMutationResolvers", moderationMutationNames],
] as const;
export const checkedTypeFieldGroups: readonly (readonly [string, string])[] = [];
export const checkedTypeFieldNames: readonly string[] = [];
export const checkedResolverFields = [
  ...checkedRootGroups.flatMap(([prefix, , , names]) => names.map(name => `${prefix}.${name}`)),
  ...checkedTypeFieldNames,
].sort();
