import type { Driver, ManagedTransaction } from "neo4j-driver";
import { resolveNeo4jDatabase } from "../neo4jDatabase.js";

export type RoleDefinition = Readonly<{
  name: string;
  [property: string]: string | boolean;
}>;

export const DEFAULT_ROLE_RELATIONSHIPS = {
  DefaultServerRole: {
    roleLabel: "ServerRole",
    relationshipType: "HAS_DEFAULT_SERVER_ROLE",
  },
  DefaultModRole: {
    roleLabel: "ModServerRole",
    relationshipType: "HAS_DEFAULT_MOD_ROLE",
  },
  DefaultElevatedModRole: {
    roleLabel: "ModServerRole",
    relationshipType: "HAS_DEFAULT_ELEVATED_MOD_ROLE",
  },
  DefaultSuspendedRole: {
    roleLabel: "ServerRole",
    relationshipType: "HAS_DEFAULT_SUSPENDED_ROLE",
  },
  DefaultSuspendedModRole: {
    roleLabel: "ModServerRole",
    relationshipType: "HAS_DEFAULT_SUSPENDED_ROLE",
  },
  DefaultAdminRole: {
    roleLabel: "ServerRole",
    relationshipType: "HAS_DEFAULT_ADMIN_ROLE",
  },
  DefaultSuperAdminRole: {
    roleLabel: "ServerRole",
    relationshipType: "HAS_DEFAULT_SUPER_ADMIN_ROLE",
  },
} as const;

export type DefaultRoleRelationship = keyof typeof DEFAULT_ROLE_RELATIONSHIPS;

export type ServerDefaultsReconcileInput = {
  serverName: string;
  serverRoles: readonly RoleDefinition[];
  modServerRoles: readonly RoleDefinition[];
  wiring: ReadonlyArray<{
    relationship: DefaultRoleRelationship;
    roleName: string;
  }>;
};

export type ServerDefaultsResult = {
  serverRolesUpserted: number;
  modServerRolesUpserted: number;
  serverConfigCreated: boolean;
  rolesWired: string[];
  adminsBackfilledToSuperAdmins: string[];
};

export interface ServerDefaultsRepository {
  reconcile(input: ServerDefaultsReconcileInput): Promise<ServerDefaultsResult>;
}

export const UPSERT_SERVER_ROLES_QUERY = `
  UNWIND $roles AS roleProperties
  MERGE (role:ServerRole {name: roleProperties.name})
  SET role += roleProperties
`;

export const UPSERT_MOD_SERVER_ROLES_QUERY = `
  UNWIND $roles AS roleProperties
  MERGE (role:ModServerRole {name: roleProperties.name})
  SET role += roleProperties
`;

export const ENSURE_SERVER_CONFIG_QUERY = `
  OPTIONAL MATCH (existing:ServerConfig {serverName: $serverName})
  WITH existing, existing IS NULL AS created
  MERGE (serverConfig:ServerConfig {serverName: $serverName})
  RETURN created
`;

const createRoleWiringQuery = (
  roleLabel: "ServerRole" | "ModServerRole",
  relationshipType: string
) => `
  MATCH (serverConfig:ServerConfig {serverName: $serverName})
  MATCH (role:${roleLabel} {name: $roleName})
  OPTIONAL MATCH (serverConfig)-[existing:${relationshipType}]->(current:${roleLabel})
  WITH serverConfig, role, collect(existing) AS existingRelationships,
       collect(current.name) AS currentRoleNames
  WITH serverConfig, role, existingRelationships,
       size(existingRelationships) <> 1 OR currentRoleNames[0] <> $roleName AS changed
  FOREACH (relationship IN CASE WHEN changed THEN existingRelationships ELSE [] END |
    DELETE relationship
  )
  FOREACH (_ IN CASE WHEN changed THEN [1] ELSE [] END |
    MERGE (serverConfig)-[:${relationshipType}]->(role)
  )
  RETURN changed
`;

export const ROLE_WIRING_QUERIES = Object.fromEntries(
  Object.entries(DEFAULT_ROLE_RELATIONSHIPS).map(
    ([relationship, { roleLabel, relationshipType }]) => [
      relationship,
      createRoleWiringQuery(roleLabel, relationshipType),
    ]
  )
) as Record<DefaultRoleRelationship, string>;

export const BACKFILL_ADMINS_QUERY = `
  MATCH (serverConfig:ServerConfig {serverName: $serverName})
  OPTIONAL MATCH (admin:User)-[:ADMIN_OF_SERVER]->(serverConfig)
  WHERE admin IS NULL OR NOT (admin)-[:SUPER_ADMIN_OF_SERVER]->(serverConfig)
  WITH serverConfig, admin
  ORDER BY admin.username
  WITH serverConfig, [candidate IN collect(admin) WHERE candidate IS NOT NULL] AS admins
  FOREACH (admin IN admins |
    MERGE (admin)-[:SUPER_ADMIN_OF_SERVER]->(serverConfig)
  )
  RETURN [admin IN admins | admin.username] AS usernames
`;

const reconcileInTransaction = async (
  transaction: ManagedTransaction,
  input: ServerDefaultsReconcileInput
): Promise<ServerDefaultsResult> => {
  await transaction.run(UPSERT_SERVER_ROLES_QUERY, {
    roles: input.serverRoles.map((role) => ({ ...role })),
  });
  await transaction.run(UPSERT_MOD_SERVER_ROLES_QUERY, {
    roles: input.modServerRoles.map((role) => ({ ...role })),
  });

  const configResult = await transaction.run(ENSURE_SERVER_CONFIG_QUERY, {
    serverName: input.serverName,
  });
  const serverConfigCreated =
    configResult.records[0]?.get("created") === true;

  const rolesWired: string[] = [];
  for (const { relationship, roleName } of input.wiring) {
    const result = await transaction.run(ROLE_WIRING_QUERIES[relationship], {
      serverName: input.serverName,
      roleName,
    });
    const record = result.records[0];
    if (!record) {
      throw new Error(
        `Cannot wire ${relationship}: role '${roleName}' does not exist.`
      );
    }
    if (record.get("changed") === true) {
      rolesWired.push(relationship);
    }
  }

  const backfillResult = await transaction.run(BACKFILL_ADMINS_QUERY, {
    serverName: input.serverName,
  });
  const adminsBackfilledToSuperAdmins = (
    backfillResult.records[0]?.get("usernames") ?? []
  ).filter((username: unknown): username is string => typeof username === "string");

  return {
    serverRolesUpserted: input.serverRoles.length,
    modServerRolesUpserted: input.modServerRoles.length,
    serverConfigCreated,
    rolesWired,
    adminsBackfilledToSuperAdmins,
  };
};

export function createServerDefaultsRepository(
  driver: Driver,
  database = resolveNeo4jDatabase()
): ServerDefaultsRepository {
  return {
    async reconcile(input) {
      const session = driver.session({ database });
      try {
        return await session.executeWrite((transaction) =>
          reconcileInTransaction(transaction, input)
        );
      } finally {
        await session.close();
      }
    },
  };
}
