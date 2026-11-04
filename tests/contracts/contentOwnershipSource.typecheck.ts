import type { UserOwnershipRecord, ActorIdentity, IssueLockRecord } from '../../customResolvers/contracts/contentOwnershipSource.js';
declare const owner: UserOwnershipRecord;
declare const actor: ActorIdentity;
declare const issue: IssueLockRecord;
// @ts-expect-error native identifiers have not passed GraphQL ID completion
const id: string = owner.id;
// @ts-expect-error native usernames have not passed GraphQL String completion
const username: string | null = owner.username;
// @ts-expect-error moderator identity is also a raw stored property
const displayName: string | null = actor.displayName;
// @ts-expect-error legacy lock values retain existing truthiness semantics
const locked: boolean | null = issue.locked;
// @ts-expect-error the actor projection must include both nullable union discriminators
const incomplete: ActorIdentity = {username: 'alice'};
void [id, username, displayName, locked, incomplete];
