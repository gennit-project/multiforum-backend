import type {NativeChannelAuthorizationSnapshot} from '../../customResolvers/contracts/channelAuthorizationSource.js';
import type {ChannelCapabilityMap,ChannelAuthorizationSnapshot} from '../../services/persistence/channelPermissionRepository.js';
declare const source:NativeChannelAuthorizationSnapshot;
// @ts-expect-error raw persisted flag has not passed GraphQL Boolean completion
const flag:boolean=source.DefaultChannelRole!.canCreateDiscussion;
// @ts-expect-error identity property values are also unvalidated
const username:string=source.Admins[0].username;
// @ts-expect-error native query constructs every role/container key
const missing:NativeChannelAuthorizationSnapshot={locked:null,Admins:[],Moderators:[]};
declare const compatible:ChannelAuthorizationSnapshot;
// @ts-expect-error injected-adapter contract must not relabel raw flags as Boolean
const compatibleFlag:boolean=compatible.DefaultChannelRole!.canCreateDiscussion;
const raw:ChannelCapabilityMap={canCreateDiscussion:'true'};
void [flag,username,missing,compatibleFlag,raw];
