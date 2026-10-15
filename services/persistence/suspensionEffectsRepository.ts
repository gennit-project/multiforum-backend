import type { Driver } from "neo4j-driver";
import { resolveNeo4jDatabase } from "../neo4jDatabase.js";

export type DisconnectExpiredSuspensionsInput = {
  scopeName: string;
  userSuspensionIds: string[];
  modSuspensionIds: string[];
};

export type SuspensionNotificationStatus =
  | "created"
  | "disabled"
  | "duplicate"
  | "user-not-found";

export interface SuspensionEffectsRepository {
  disconnectExpiredChannelSuspensions(
    input: DisconnectExpiredSuspensionsInput
  ): Promise<void>;
  disconnectExpiredServerSuspensions(
    input: DisconnectExpiredSuspensionsInput
  ): Promise<void>;
  createBlockNotification(input: {
    username: string;
    text: string;
  }): Promise<SuspensionNotificationStatus>;
}

const createDisconnectQuery = (
  scopeLabel: "Channel" | "ServerConfig",
  scopeProperty: "uniqueName" | "serverName"
) => `
  MATCH (scope:${scopeLabel} {${scopeProperty}: $scopeName})
  OPTIONAL MATCH (scope)-[userRelationship:SUSPENDED_AS_USER]->(userSuspension:Suspension)
  WHERE userSuspension.id IN $userSuspensionIds
  WITH scope, collect(userRelationship) AS userRelationships
  OPTIONAL MATCH (scope)-[modRelationship:SUSPENDED_AS_MOD]->(modSuspension:Suspension)
  WHERE modSuspension.id IN $modSuspensionIds
  WITH userRelationships, collect(modRelationship) AS modRelationships
  FOREACH (relationship IN userRelationships | DELETE relationship)
  FOREACH (relationship IN modRelationships | DELETE relationship)
`;

export const DISCONNECT_EXPIRED_CHANNEL_SUSPENSIONS_QUERY =
  createDisconnectQuery("Channel", "uniqueName");

export const DISCONNECT_EXPIRED_SERVER_SUSPENSIONS_QUERY =
  createDisconnectQuery("ServerConfig", "serverName");

export const CREATE_SUSPENSION_BLOCK_NOTIFICATION_QUERY = `
  MATCH (user:User {username: $username})
  WITH user,
       coalesce(user.notifyOnSuspensionBlocks, true) AS notificationsEnabled,
       EXISTS {
         MATCH (user)-[:HAS_NOTIFICATION]->(:Notification {
           text: $text,
           read: false
         })
       } AS duplicate
  FOREACH (_ IN CASE
    WHEN notificationsEnabled AND NOT duplicate THEN [1]
    ELSE []
  END |
    CREATE (notification:Notification {
      id: randomUUID(),
      createdAt: datetime(),
      read: false,
      text: $text
    })
    CREATE (user)-[:HAS_NOTIFICATION]->(notification)
  )
  RETURN CASE
    WHEN NOT notificationsEnabled THEN 'disabled'
    WHEN duplicate THEN 'duplicate'
    ELSE 'created'
  END AS status
`;

export function createSuspensionEffectsRepository(
  driver: Driver,
  database = resolveNeo4jDatabase()
): SuspensionEffectsRepository {
  const disconnect = async (
    query: string,
    input: DisconnectExpiredSuspensionsInput
  ) => {
    await driver.executeQuery(
      query,
      {
        scopeName: input.scopeName,
        userSuspensionIds: input.userSuspensionIds,
        modSuspensionIds: input.modSuspensionIds,
      },
      { database }
    );
  };

  return {
    disconnectExpiredChannelSuspensions(input) {
      return disconnect(DISCONNECT_EXPIRED_CHANNEL_SUSPENSIONS_QUERY, input);
    },

    disconnectExpiredServerSuspensions(input) {
      return disconnect(DISCONNECT_EXPIRED_SERVER_SUSPENSIONS_QUERY, input);
    },

    async createBlockNotification(input) {
      const result = await driver.executeQuery(
        CREATE_SUSPENSION_BLOCK_NOTIFICATION_QUERY,
        input,
        { database }
      );
      return (
        result.records[0]?.get("status") ?? "user-not-found"
      ) as SuspensionNotificationStatus;
    },
  };
}
