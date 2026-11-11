import type {BotIdentityProjection,BotChannelProjection,ChannelBotSettingsProjection,ServerBotSettingsProjection,BotUserWriteProjection,BotChannelWriteProjection} from '../../customResolvers/contracts/botProvisioningProjections.js';
const identity:BotIdentityProjection={username:'bot',isBot:null,botProfileId:null,isDeprecated:null,deprecatedReason:null};
// @ts-expect-error selected nullable bot fields are not omitted
const missing:BotIdentityProjection={username:'bot'};
// @ts-expect-error identity read does not fetch displayName
void identity.displayName;
// @ts-expect-error channel lookup always selects its Bots relationship
const missingBots:BotChannelProjection={uniqueName:'forum'};
declare const channel:ChannelBotSettingsProjection;
declare const server:ServerBotSettingsProjection;
declare const userWrite:BotUserWriteProjection;
declare const channelWrite:BotChannelWriteProjection;
// @ts-expect-error source only selects bot identities, not full Users
void channel.Bots[0].Email;
// @ts-expect-error Plugin is nullable in the executed selection
const pluginName:string=server.InstalledVersionsConnection.edges[0].node.Plugin.name;
// @ts-expect-error default mutation projection does not fetch user memberships
void userWrite.JoinedChannels;
// @ts-expect-error default channel mutation projection does not include bot relation
void channelWrite.Bots;
void [identity,missing,missingBots,pluginName];
