/** Native Cypher constructs these containers, but reads property values without
 * GraphQL scalar completion. Stored capability/identity leaves remain unknown. */
export type RawChannelCapabilities=Record<string,unknown>;
export type NativeChannelAuthorizationSnapshot={
 locked:unknown;
 Admins:{username:unknown}[];
 Moderators:{displayName:unknown}[];
 DefaultChannelRole:RawChannelCapabilities|null;
 ElevatedChannelRole:RawChannelCapabilities|null;
 SuspendedRole:RawChannelCapabilities|null;
 DefaultModRole:RawChannelCapabilities|null;
 ElevatedModRole:RawChannelCapabilities|null;
 SuspendedModRole:RawChannelCapabilities|null;
};
export type ChannelAuthorizationRecord={channel:NativeChannelAuthorizationSnapshot};
