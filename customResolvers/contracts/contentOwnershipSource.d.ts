// Native Cypher properties have not undergone GraphQL scalar completion.
export type UserOwnershipRecord = {
  id: unknown;
  username: unknown;
};

export type ActorIdentity = {
  username: unknown;
  displayName: unknown;
};

export type ActorAuthorizationRecord = {
  found: boolean;
  actor: ActorIdentity | null;
};

export type UserAuthorizationRecord = {
  found: boolean;
  username: unknown;
};

export type IssueLockRecord = {
  found: boolean;
  locked: unknown;
};

