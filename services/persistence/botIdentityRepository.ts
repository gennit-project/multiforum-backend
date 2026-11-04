import type {Driver} from 'neo4j-driver';
import type {UserCreateInput,UserUpdateInput} from '../../ogm_types.js';
import type {BotIdentityProjection,BotUserWriteProjection,BotChannelProjection,BotChannelWriteProjection} from '../../customResolvers/contracts/botProvisioningProjections.js';
import {executeGeneratedOperation} from './generatedSchemaOperations.js';
import {NOTIFICATION_USER_SELECTION} from './notificationWriter.js';
import {CHANNEL_MEMBERSHIP_SELECTION} from './forumMembershipSelections.js';
export interface BotIdentityRepository {
 findIdentity(username:string):Promise<BotIdentityProjection[]>;
 createIdentity(input:UserCreateInput):Promise<{users:BotUserWriteProjection[]}>;
 reactivateIdentity(username:string,update:UserUpdateInput):Promise<{users:BotUserWriteProjection[]}>;
 findChannelBots(uniqueName:string):Promise<BotChannelProjection[]>;
 connectBot(uniqueName:string,username:string):Promise<{channels:BotChannelWriteProjection[]}>;
 disconnectBots(uniqueName:string,usernames:string[]):Promise<{channels:BotChannelWriteProjection[]}>;
}
const IDENTITY=`query BotIdentity($where:UserWhere){users(where:$where){username isBot botProfileId isDeprecated deprecatedReason}}`;
const CREATE=`mutation CreateBotIdentity($input:[UserCreateInput!]!){createUsers(input:$input){users ${NOTIFICATION_USER_SELECTION}}}`;
const REACTIVATE=`mutation ReactivateBotIdentity($where:UserWhere,$update:UserUpdateInput){updateUsers(where:$where,update:$update){users ${NOTIFICATION_USER_SELECTION}}}`;
const CHANNEL=`query BotChannelIdentities($where:ChannelWhere){channels(where:$where){uniqueName Bots {username}}}`;
// v7 removed the top-level connect/disconnect args on updateX; a to-many
// connect/disconnect is expressed inside the update input's relationship field.
const CONNECT=`mutation ConnectBotIdentity($where:ChannelWhere,$update:ChannelUpdateInput){updateChannels(where:$where,update:$update){channels ${CHANNEL_MEMBERSHIP_SELECTION}}}`;
const DISCONNECT=`mutation DisconnectBotIdentities($where:ChannelWhere,$update:ChannelUpdateInput){updateChannels(where:$where,update:$update){channels ${CHANNEL_MEMBERSHIP_SELECTION}}}`;
export function createBotIdentityRepository(driver:Driver):BotIdentityRepository{return{
 async findIdentity(username){return(await executeGeneratedOperation<{users:BotIdentityProjection[]}>(driver,IDENTITY,{where:{username:{eq:username}}})).users;},
 async createIdentity(input){return(await executeGeneratedOperation<{createUsers:{users:BotUserWriteProjection[]}}>(driver,CREATE,{input:[input]})).createUsers;},
 async reactivateIdentity(username,update){return(await executeGeneratedOperation<{updateUsers:{users:BotUserWriteProjection[]}}>(driver,REACTIVATE,{where:{username:{eq:username}},update})).updateUsers;},
 async findChannelBots(uniqueName){return(await executeGeneratedOperation<{channels:BotChannelProjection[]}>(driver,CHANNEL,{where:{uniqueName:{eq:uniqueName}}})).channels;},
 async connectBot(uniqueName,username){return(await executeGeneratedOperation<{updateChannels:{channels:BotChannelWriteProjection[]}}>(driver,CONNECT,{where:{uniqueName:{eq:uniqueName}},update:{Bots:[{connect:[{where:{node:{username:{eq:username}}}}]}]}})).updateChannels;},
 async disconnectBots(uniqueName,usernames){return(await executeGeneratedOperation<{updateChannels:{channels:BotChannelWriteProjection[]}}>(driver,DISCONNECT,{where:{uniqueName:{eq:uniqueName}},update:{Bots:[{disconnect:usernames.map(username=>({where:{node:{username:{eq:username}}}}))}]}})).updateChannels;},
};}
