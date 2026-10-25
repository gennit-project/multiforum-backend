import type {Driver} from 'neo4j-driver';
import type {Channel,ServerConfig,User} from '../../ogm_types.js';
import {executeGeneratedOperation} from './generatedSchemaOperations.js';
import {NOTIFICATION_USER_SELECTION} from './notificationWriter.js';
import {createBotIdentityRepository} from './botIdentityRepository.js';
export interface ChannelBotRepository {
 findChannelPlugins(uniqueName:string):Promise<Channel[]>;
 findServerPlugins():Promise<ServerConfig[]>;
 deprecateBot(username:string,reason:string):Promise<{users:User[]}>;
 disconnectOrphans(uniqueName:string,usernames:string[]):Promise<{channels:Channel[]}>;
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
 async findChannelPlugins(uniqueName){return(await executeGeneratedOperation<{channels:Channel[]}>(driver,CHANNEL,{where:{uniqueName:{eq:uniqueName}}})).channels;},
 async findServerPlugins(){return(await executeGeneratedOperation<{serverConfigs:ServerConfig[]}>(driver,SERVER,{})).serverConfigs;},
 async deprecateBot(username,reason){return(await executeGeneratedOperation<{updateUsers:{users:User[]}}>(driver,DEPRECATE,{where:{username:{eq:username}},update:{isDeprecated:{set:true},deprecatedReason:{set:reason}}})).updateUsers;},
 disconnectOrphans(uniqueName,usernames){return createBotIdentityRepository(driver).disconnectBots(uniqueName,usernames);},
};}
