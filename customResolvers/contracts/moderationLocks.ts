import type { AbsentLockMetadata } from "./moderationLockMetadata.js";
import type { MutationResolvers, Channel, Issue } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { Selection, SelectedResolver } from "./selection.js";

export const channelLockSelection = {uniqueName:true,locked:true,lockedAt:true,lockReason:true} as const satisfies Selection<Channel>;
export const issueLockSelection = {id:true,locked:true,lockedAt:true,lockReason:true} as const satisfies Selection<Issue>;
export const moderationLockMutationNames = ["lockChannel","unlockChannel","lockIssue","unlockIssue"] as const;
type IssueLockResolver<R extends (...args: never[]) => unknown> = (...args: Parameters<R>) =>
 AbsentLockMetadata<Awaited<ReturnType<R>>> | Promise<AbsentLockMetadata<Awaited<ReturnType<R>>>>;
export type ModerationLockMutationResolvers = {
 lockChannel: SelectedResolver<MutationResolvers<GraphQLContext>["lockChannel"],typeof channelLockSelection>;
 unlockChannel: SelectedResolver<MutationResolvers<GraphQLContext>["unlockChannel"],typeof channelLockSelection>;
 lockIssue: IssueLockResolver<SelectedResolver<MutationResolvers<GraphQLContext>["lockIssue"],typeof issueLockSelection>>;
 unlockIssue: IssueLockResolver<SelectedResolver<MutationResolvers<GraphQLContext>["unlockIssue"],typeof issueLockSelection>>;
};
