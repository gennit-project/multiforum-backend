import type {ModelMap} from "../../ogm_types.js";
import type {SeedDataRepository} from "../../services/persistence/seedDataRepository.js";
export function seedDataRepositoryStub(models:Pick<ModelMap,'ModChannelRole'|'ChannelRole'|'ModServerRole'|'ServerRole'|'ServerConfig'|'Channel'|'Tag'|'Comment'>):SeedDataRepository{return {
 async createModChannelRoles(input){await models.ModChannelRole.create({input});},
 async createChannelRoles(input){await models.ChannelRole.create({input});},
 async createModServerRoles(input){await models.ModServerRole.create({input});},
 async createServerRoles(input){await models.ServerRole.create({input});},
 async createServerConfigs(input){await models.ServerConfig.create({input});},
 async connectDefaultRoles(){await models.ServerConfig.update({where:{ serverName: "Cypress Test Server" },update:{
          DefaultServerRole: {
            connect: {
              where: {
                node: { name: "CanCreateAnything" },
              },
              overwrite: true,
            },
          },
          DefaultSuspendedRole: {
            connect: {
              where: {
                node: { name: "Suspended Role" },
              },
              overwrite: true,
            },
          },
          DefaultElevatedModRole: {
            connect: {
              where: {
                node: {
                  name: "DefaultElevatedModRole"
                },
              },
              overwrite: true,
            }
          },
          DefaultModRole: {
            connect: {
              where: {
                node: {
                  name: "BasicModRole"
                }
              }
            }
          },
          DefaultSuspendedModRole: {
            connect: {
              where: {
                node: {
                  name: "DefaultSuspendedModRole"
                }
              }
            }
          }
        }});},
 async createChannels(input){await models.Channel.create({input});},
 async createTags(input){await models.Tag.create({input});},
 async createComments(input){await models.Comment.create({input});},
};}
