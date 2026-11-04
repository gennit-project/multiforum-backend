import type {Driver} from 'neo4j-driver';
import type {ChannelBotSettingsProjection,ServerBotSettingsProjection,BotUserWriteProjection,BotChannelWriteProjection} from '../../customResolvers/contracts/botProvisioningProjections.js';
import {executeGeneratedOperation} from './generatedSchemaOperations.js';
import {NOTIFICATION_USER_SELECTION} from './notificationWriter.js';
import {createBotIdentityRepository} from './botIdentityRepository.js';
export interface ChannelBotRepository {
 findChannelPlugins(uniqueName:string):Promise<ChannelBotSettingsProjection[]>;
 findServerPlugins():Promise<ServerBotSettingsProjection[]>;
 deprecateBot(username:string,reason:string):Promise<{users:BotUserWriteProjection[]}>;
 disconnectOrphans(uniqueName:string,usernames:string[]):Promise<{channels:BotChannelWriteProjection[]}>;
}
export const CHANNEL_BOT_SELECTION=`{
        uniqueName
        Bots {
          username
        }
        EnabledPluginsConnection {
          edges {
            properties {
              enabled
              settingsJson
            }
            node {
              settingsDefaults
              Plugin {
                name
                tags
              }
            }
          }
        }
      }`;
export const SERVER_BOT_SELECTION=`{
        serverName
        InstalledVersionsConnection {
          edges {
            properties {
              enabled
              settingsJson
            }
            node {
              version
              settingsDefaults
              Plugin {
                name
                tags
              }
            }
          }
        }
      }`;
const CHANNEL=`query ChannelBotSettings($where:ChannelWhere){channels(where:$where) ${CHANNEL_BOT_SELECTION}}`;
const SERVER=`query ServerBotSettings{serverConfigs ${SERVER_BOT_SELECTION}}`;
const DEPRECATE=`mutation DeprecateChannelBot($where:UserWhere,$update:UserUpdateInput){updateUsers(where:$where,update:$update){users ${NOTIFICATION_USER_SELECTION}}}`;
export function createChannelBotRepository(driver:Driver):ChannelBotRepository{return{
 async findChannelPlugins(uniqueName){return(await executeGeneratedOperation<{channels:ChannelBotSettingsProjection[]}>(driver,CHANNEL,{where:{uniqueName:{eq:uniqueName}}})).channels;},
 async findServerPlugins(){return(await executeGeneratedOperation<{serverConfigs:ServerBotSettingsProjection[]}>(driver,SERVER,{})).serverConfigs;},
 async deprecateBot(username,reason){return(await executeGeneratedOperation<{updateUsers:{users:BotUserWriteProjection[]}}>(driver,DEPRECATE,{where:{username:{eq:username}},update:{isDeprecated:{set:true},deprecatedReason:{set:reason}}})).updateUsers;},
 disconnectOrphans(uniqueName,usernames){return createBotIdentityRepository(driver).disconnectBots(uniqueName,usernames);},
};}
