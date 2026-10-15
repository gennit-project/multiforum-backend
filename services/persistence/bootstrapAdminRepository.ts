import type { Driver, ManagedTransaction } from "neo4j-driver";
import { resolveNeo4jDatabase } from "../neo4jDatabase.js";

export type BootstrapAdminResult =
  | { status: "created"; username: string }
  | { status: "connected"; username: string }
  | { status: "unchanged"; username: string }
  | { status: "skipped"; reason: "database-not-empty" };

export type BootstrapAdminIdentity = {
  serverName: string;
  email: string;
  username: string;
};

export interface BootstrapAdminRepository {
  reconcile(input: BootstrapAdminIdentity): Promise<BootstrapAdminResult>;
}

export const FIND_BOOTSTRAP_IDENTITY_QUERY = `
  OPTIONAL MATCH (user:User {username: $username})
  OPTIONAL MATCH (email:Email {address: $email})
  RETURN user IS NOT NULL AS userExists,
         email IS NOT NULL AS emailExists,
         [(user)<-[:HAS_EMAIL]-(linkedEmail:Email) | linkedEmail.address] AS linkedEmails,
         [(email)-[:HAS_EMAIL]->(linkedUser:User) | linkedUser.username] AS linkedUsernames
`;

export const DATABASE_HAS_USERS_QUERY = `
  MATCH (user:User)
  RETURN count(user) > 0 AS hasUsers
`;

export const CREATE_BOOTSTRAP_IDENTITY_QUERY = `
  CREATE (user:User {
    username: $username,
    createdAt: datetime(),
    isBot: false,
    isDeprecated: false,
    notifyOnReplyToCommentByDefault: true,
    notifyOnReplyToDiscussionByDefault: true,
    notifyOnReplyToEventByDefault: true,
    notifyWhenTagged: true,
    notifyOnSubscribedIssueUpdates: true,
    notifyOnFeedback: true,
    notifyOnSuspensionBlocks: true,
    notificationBundleEnabled: true
  })
  CREATE (email:Email {address: $email})
  CREATE (profile:ModerationProfile {
    displayName: $moderationProfileName,
    createdAt: datetime()
  })
  CREATE (email)-[:HAS_EMAIL]->(user)
  CREATE (user)-[:MODERATION_PROFILE]->(profile)
`;

export const FIND_BOOTSTRAP_SERVER_QUERY = `
  MATCH (user:User {username: $username})
  OPTIONAL MATCH (serverConfig:ServerConfig {serverName: $serverName})
  OPTIONAL MATCH (user)-[membership:SUPER_ADMIN_OF_SERVER]->(serverConfig)
  RETURN serverConfig IS NOT NULL AS serverExists,
         count(membership) > 0 AS alreadyConnected
`;

export const CONNECT_BOOTSTRAP_ADMIN_QUERY = `
  MATCH (user:User {username: $username})
  MATCH (serverConfig:ServerConfig {serverName: $serverName})
  MERGE (user)-[:SUPER_ADMIN_OF_SERVER]->(serverConfig)
`;

type IdentityState = {
  userExists: boolean;
  emailExists: boolean;
  linkedEmails: Array<string | null>;
  linkedUsernames: Array<string | null>;
};

const getIdentityState = async (
  transaction: ManagedTransaction,
  input: BootstrapAdminIdentity
): Promise<IdentityState> => {
  const result = await transaction.run(FIND_BOOTSTRAP_IDENTITY_QUERY, {
    username: input.username,
    email: input.email,
  });
  const record = result.records[0];
  return {
    userExists: record?.get("userExists") === true,
    emailExists: record?.get("emailExists") === true,
    linkedEmails: record?.get("linkedEmails") ?? [],
    linkedUsernames: record?.get("linkedUsernames") ?? [],
  };
};

const validateIdentityState = (
  state: IdentityState,
  input: BootstrapAdminIdentity
): void => {
  if (
    state.userExists &&
    state.linkedEmails.some((linkedEmail) => linkedEmail !== input.email)
  ) {
    throw new Error(
      `Cannot bootstrap '${input.username}': that username is linked to a different email.`
    );
  }
  if (
    state.emailExists &&
    state.linkedUsernames.some(
      (linkedUsername) => linkedUsername !== input.username
    )
  ) {
    throw new Error(
      `Cannot bootstrap '${input.username}': '${input.email}' is linked to a different username.`
    );
  }
  if (
    state.userExists !== state.emailExists ||
    (state.userExists &&
      (state.linkedEmails.length !== 1 || state.linkedUsernames.length !== 1))
  ) {
    throw new Error(
      `Cannot bootstrap '${input.username}': the existing user/email relationship is incomplete.`
    );
  }
};

const reconcileInTransaction = async (
  transaction: ManagedTransaction,
  input: BootstrapAdminIdentity
): Promise<BootstrapAdminResult> => {
  const identity = await getIdentityState(transaction, input);
  validateIdentityState(identity, input);

  let created = false;
  if (!identity.userExists) {
    const userCount = await transaction.run(DATABASE_HAS_USERS_QUERY);
    if (userCount.records[0]?.get("hasUsers") === true) {
      return { status: "skipped", reason: "database-not-empty" };
    }

    await transaction.run(CREATE_BOOTSTRAP_IDENTITY_QUERY, {
      username: input.username,
      email: input.email,
      moderationProfileName: `bootstrap-${input.username}`,
    });
    created = true;
  }

  const serverResult = await transaction.run(FIND_BOOTSTRAP_SERVER_QUERY, {
    username: input.username,
    serverName: input.serverName,
  });
  const serverRecord = serverResult.records[0];
  if (serverRecord?.get("serverExists") !== true) {
    throw new Error(
      `Cannot bootstrap '${input.username}': ServerConfig '${input.serverName}' does not exist.`
    );
  }
  if (serverRecord.get("alreadyConnected") === true) {
    return { status: "unchanged", username: input.username };
  }

  await transaction.run(CONNECT_BOOTSTRAP_ADMIN_QUERY, {
    username: input.username,
    serverName: input.serverName,
  });
  return {
    status: created ? "created" : "connected",
    username: input.username,
  };
};

export function createBootstrapAdminRepository(
  driver: Driver,
  database = resolveNeo4jDatabase()
): BootstrapAdminRepository {
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
