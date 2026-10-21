import { createEventWriteRepository } from "../../services/persistence/eventWriteRepository.js";
import {createDiscussionCreationRepository} from "../../services/persistence/discussionCreationRepository.js";
import {createSeedDataRepository,type SeedDataRepository} from "../../services/persistence/seedDataRepository.js";
import { createAccountRegistrationRepository } from "../../services/persistence/accountRegistrationRepository.js";
import {
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
  seedDataRepository?: SeedDataRepository;
  driver: Driver;
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

    const repository = input.seedDataRepository ?? createSeedDataRepository(driver);

    // Create entities in the correct order to satisfy dependencies
    await repository.createModChannelRoles(modChannelRoles);
    await repository.createChannelRoles(channelRoles);
    await repository.createModServerRoles(modServerRoles);
    await repository.createServerRoles(serverRoles);

    // Create server configurations
    await repository.createServerConfigs(serverConfigs);

    // Update the default server role in the server configuration
    const session = driver.session();
    try {
      await repository.connectDefaultRoles();
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
    await repository.createChannels(channels);
    await linkSeededChannelRoleOwners(driver);
    await repository.createTags(tags);
    await createDiscussionsFromInput(createDiscussionCreationRepository(driver), driver, discussions);
    await createEventsFromInput(createEventWriteRepository(driver), driver, events, context);
    await repository.createComments(comments);
    return { success: true, message: "All test data has been created." };
  };
};

export default seedDataForCypressTestsResolver;
