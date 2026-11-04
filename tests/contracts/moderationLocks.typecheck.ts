import type { ModerationLockMutationResolvers } from "../../customResolvers/contracts/moderationLocks.js";
import type { ChannelLockResult } from "../../services/persistence/channelModerationRepository.js";
import type { IssueLockResult } from "../../services/persistence/issueLockRepository.js";
import lockChannel from "../../customResolvers/mutations/lockChannel.js";
import unlockChannel from "../../customResolvers/mutations/unlockChannel.js";
import lockIssue from "../../customResolvers/mutations/lockIssue.js";
import unlockIssue from "../../customResolvers/mutations/unlockIssue.js";
declare const a: ReturnType<typeof lockChannel>, b: ReturnType<typeof unlockChannel>, c: ReturnType<typeof lockIssue>, d: ReturnType<typeof unlockIssue>;
const checked: ModerationLockMutationResolvers = {lockChannel:a,unlockChannel:b,lockIssue:c,unlockIssue:d};
declare const issue: IssueLockResult, channel: ChannelLockResult;
// @ts-expect-error unrelated persisted issue fields are unknown, never a full Issue
const rawBody: string = issue.body;
// @ts-expect-error unrelated persisted issueNumber is not guaranteed by lock writes
const rawNumber: number = issue.issueNumber;
// @ts-expect-error persisted displayName retains outer GraphQL coercion
const rawName: string = channel.displayName;
// @ts-expect-error MATCH identity is mandatory
const missingIdentity: IssueLockResult = {locked:true};
// @ts-expect-error SET boolean is not a string
const malformedLock: IssueLockResult = {id:"i",locked:"true"};
// @ts-expect-error converted temporal values are not raw driver objects
const malformedTime: IssueLockResult = {id:"i",locked:true,lockedAt:{year:2026}};
void [checked,rawBody,rawNumber,rawName,missingIdentity,malformedLock,malformedTime];

const absentNullableMetadata: ModerationLockMutationResolvers["unlockIssue"] = async () => ({id:"i",locked:false});
// @ts-expect-error nullable metadata optionalization cannot omit the non-null id
const missingBoundaryIdentity: ModerationLockMutationResolvers["unlockIssue"] = async () => ({locked:false});
// @ts-expect-error nullable metadata still follows the generated string contract
const invalidBoundaryReason: ModerationLockMutationResolvers["lockIssue"] = async () => ({id:"i",locked:true,lockReason:42});
void [absentNullableMetadata,missingBoundaryIdentity,invalidBoundaryReason];

// A future non-null schema metadata field must fail the omission adapter itself.
import type { AbsentLockMetadata } from "../../customResolvers/contracts/moderationLockMetadata.js";
// @ts-expect-error non-null metadata cannot use the absent-nullable response adapter
const nonNullMetadataDrift: AbsentLockMetadata<{id:string;lockedAt:string;lockReason:string}> = {id:"i"};
void nonNullMetadataDrift;
