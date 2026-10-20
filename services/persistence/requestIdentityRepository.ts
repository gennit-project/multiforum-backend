import neo4j, { type Driver } from "neo4j-driver";
import { resolveNeo4jDatabase } from "../neo4jDatabase.js";

export type PersistedRequestUser = {
  username: string;
  dateOfBirth: string | null;
  modProfileName: string | null;
};

export interface RequestIdentityRepository {
  findByUsername(username: string): Promise<PersistedRequestUser | null>;
  findByEmail(email: string): Promise<PersistedRequestUser | null>;
  userExists(username: string): Promise<boolean>;
}

const REQUEST_USER_PROJECTION = `
  OPTIONAL MATCH (user)-[:MODERATION_PROFILE]->(profile:ModerationProfile)
  RETURN user.username AS username,
         toString(user.dateOfBirth) AS dateOfBirth,
         profile.displayName AS modProfileName
  LIMIT 1
`;

export const FIND_REQUEST_USER_BY_USERNAME_QUERY = `
  MATCH (user:User {username: $username})
  ${REQUEST_USER_PROJECTION}
`;

export const FIND_REQUEST_USER_BY_EMAIL_QUERY = `
  MATCH (:Email {address: $email})-[:HAS_EMAIL]->(user:User)
  ${REQUEST_USER_PROJECTION}
`;

export const USER_EXISTS_QUERY = `
  MATCH (user:User {username: $username})
  RETURN true AS exists
  LIMIT 1
`;

const normalizeDate = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return String(value);
};

const normalizeNullableString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

export function createRequestIdentityRepository(
  driver: Driver,
  database = resolveNeo4jDatabase()
): RequestIdentityRepository {
  const openIdentitySession = () =>
    driver.session({
      database,
      // Identity and ownership checks remain leader-routed so request-scoped
      // bookmarks preserve read-your-own-writes behavior during mutations.
      defaultAccessMode: neo4j.session.WRITE,
    });

  const findUser = async (
    query: string,
    parameters: Record<string, string>
  ): Promise<PersistedRequestUser | null> => {
    const session = openIdentitySession();
    try {
      const result = await session.run(query, parameters);
      const record = result.records[0];
      if (!record) return null;

      const username = record.get("username");
      if (typeof username !== "string" || !username) return null;

      return {
        username,
        dateOfBirth: normalizeDate(record.get("dateOfBirth")),
        modProfileName: normalizeNullableString(record.get("modProfileName")),
      };
    } finally {
      await session.close();
    }
  };

  return {
    findByUsername(username) {
      return findUser(FIND_REQUEST_USER_BY_USERNAME_QUERY, { username });
    },

    findByEmail(email) {
      return findUser(FIND_REQUEST_USER_BY_EMAIL_QUERY, { email });
    },

    async userExists(username) {
      const session = openIdentitySession();
      try {
        const result = await session.run(USER_EXISTS_QUERY, { username });
        return result.records[0]?.get("exists") === true;
      } finally {
        await session.close();
      }
    },
  };
}

export const resolveRequestIdentityRepository = (context: {
  requestIdentityRepository?: RequestIdentityRepository;
  driver: Driver;
}): RequestIdentityRepository =>
  context.requestIdentityRepository ??
  createRequestIdentityRepository(context.driver);
