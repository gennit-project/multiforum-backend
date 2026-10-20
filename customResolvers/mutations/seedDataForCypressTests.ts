import { createAccountRegistrationRepository } from "../../services/persistence/accountRegistrationRepository.js";
import {
  ChannelModel,
  EventModel,
  DiscussionModel,
  CommentModel,
  TagModel,
  ChannelRoleModel,
  ModChannelRoleModel,
  ServerRoleModel,
  ModServerRoleModel,
  ServerConfigModel,
  ChannelCreateInput,
  CommentCreateInput,
  TagCreateInput,
  ChannelRoleCreateInput,
  ModChannelRoleCreateInput,
  ServerRoleCreateInput,
  ModServerRoleCreateInput,
  ServerConfigCreateInput,
} from "../../ogm_types.js";
import { createUsersWithEmails } from "./createEmailAndUser.js";
import { createDiscussionsFromInput } from "./createDiscussionWithChannelConnections.js";
import { createEventsFromInput } from "./createEventWithChannelConnections.js";
import {
  DiscussionCreateInputWithChannels,
  EventCreateInputWithChannels,
} from "../../src/generated/graphql.js";
import type { GraphQLResolveInfo } from "graphql";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import { logger } from "../../logger.js";

type NewUserInput = {
  emailAddress: string;
  username: string;
};

type Args = {
  channels: ChannelCreateInput[];
  users: NewUserInput[];
  tags: TagCreateInput[];
  discussions: DiscussionCreateInputWithChannels[];
  events: EventCreateInputWithChannels[];
  comments: CommentCreateInput[];
  channelRoles: ChannelRoleCreateInput[];
  modChannelRoles: ModChannelRoleCreateInput[];
  serverRoles: ServerRoleCreateInput[];
  modServerRoles: ModServerRoleCreateInput[];
  serverConfigs: ServerConfigCreateInput[];
};

type Input = {
  driver: Driver;
  Channel: ChannelModel;
  Comment: CommentModel;
  Discussion: DiscussionModel;
  Event: EventModel;
  Tag: TagModel;
  ChannelRole: ChannelRoleModel;
  ModChannelRole: ModChannelRoleModel;
  ServerRole: ServerRoleModel;
  ModServerRole: ModServerRoleModel;
  ServerConfig: ServerConfigModel;
};

export const linkSeededChannelRoleOwners = async (driver: Driver) => {
  const session = driver.session();
  try {
    await session.run(`
      MATCH (role:ChannelRole)
      MATCH (channel:Channel {uniqueName: role.channelUniqueName})
      MERGE (channel)-[:OWNS_CHANNEL_ROLE]->(role)
    `);
    await session.run(`
      MATCH (role:ModChannelRole)
      MATCH (channel:Channel {uniqueName: role.channelUniqueName})
      MERGE (channel)-[:OWNS_MOD_CHANNEL_ROLE]->(role)
    `);
  } finally {
    await session.close();
  }
};

const seedDataForCypressTestsResolver = (input: Input) => {
  const {
    driver,
    Channel,
    Comment,
    Discussion,
    Event,
    Tag,
    ChannelRole,
    ModChannelRole,
    ServerRole,
    ModServerRole,
    ServerConfig,
  } = input;

  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext,
    resolveInfo: GraphQLResolveInfo
  ) => {
    const {
      channels,
      users,
      tags,
      discussions,
      events,
      comments,
      channelRoles,
      modChannelRoles,
      serverRoles,
      modServerRoles,
      serverConfigs,
    } = args;

    // Create entities in the correct order to satisfy dependencies
    await ModChannelRole.create({ input: modChannelRoles });
    await ChannelRole.create({ input: channelRoles });
    await ModServerRole.create({ input: modServerRoles });
    await ServerRole.create({ input: serverRoles });

    // Create server configurations
    await ServerConfig.create({ input: serverConfigs });

    // Update the default server role in the server configuration
    const session = driver.session();
    try {
      await ServerConfig.update({
        where: { serverName: "Cypress Test Server" },
        update: {
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
        },
      });
    } catch (error: unknown) {
      logger.error("Error updating server configuration:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to update server configurations: ${message}`
      );
    } finally {
      session.close();
    }

    // Create users and their emails
    for (const user of users) {
      await createUsersWithEmails(
        createAccountRegistrationRepository(driver),
        user.emailAddress,
        user.username
      );
    }

    // Create other entities
    await Channel.create({ input: channels });
    await linkSeededChannelRoleOwners(driver);
    await Tag.create({ input: tags });
    await createDiscussionsFromInput(Discussion, driver, discussions);
    await createEventsFromInput(Event, driver, events, context);
    await Comment.create({ input: comments });
    return { success: true, message: "All test data has been created." };
  };
};

export default seedDataForCypressTestsResolver;
