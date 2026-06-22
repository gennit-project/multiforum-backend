// Harness for integration-testing the image-moderation mutation resolvers
// against a live Neo4j. These resolvers are heavy DB orchestration (create an
// Issue, ModerationActions, flip Image flags), so they can only be meaningfully
// covered against a real database.
//
// We call the resolvers DIRECTLY (resolvers.Mutation.<name>) rather than through
// graphql-shield — the shield/permission wiring is covered separately by the
// auth tests. Here we exercise the resolver's database logic.
//
// Auth: the resolvers call setUserDataOnContext, so we use the app's mock-auth
// seam (E2E_MOCK_AUTH=true) with a JWT carrying username/email, and seed a
// User + ModerationProfile so the caller resolves as a moderator.

import { Neo4jContainer, StartedNeo4jContainer } from "@testcontainers/neo4j";
import neo4j, { Driver } from "neo4j-driver";
import jwt from "jsonwebtoken";
import getCustomResolvers from "../../customResolvers.js";

let container: StartedNeo4jContainer | undefined;
let driver: Driver | undefined;

export interface ImageModEnv {
  driver: Driver;
  ogm: any;
  resolvers: any;
}

export async function startImageModEnv(): Promise<ImageModEnv> {
  container = await new Neo4jContainer("neo4j:5-community").withApoc().start();
  process.env.NEO4J_URI = container.getBoltUri();
  process.env.NEO4J_USER = container.getUsername();
  process.env.NEO4J_PASSWORD = container.getPassword();
  process.env.E2E_MOCK_AUTH = "true";

  driver = neo4j.driver(
    container.getBoltUri(),
    neo4j.auth.basic(container.getUsername(), container.getPassword())
  );

  const { ogm, resolvers } = getCustomResolvers(driver);
  await ogm.init();

  return { driver, ogm, resolvers };
}

export async function stopImageModEnv(): Promise<void> {
  await driver?.close();
  await container?.stop();
  driver = undefined;
  container = undefined;
}

export async function run(
  cypher: string,
  params: Record<string, unknown> = {}
): Promise<Record<string, any>[]> {
  const session = driver!.session();
  try {
    const result = await session.run(cypher, params);
    return result.records.map((r) => r.toObject());
  } finally {
    await session.close();
  }
}

export async function resetDb(): Promise<void> {
  await run("MATCH (n) DETACH DELETE n");
}

// Seeds a moderator: a User linked to a ModerationProfile, so setUserDataOnContext
// resolves the caller as a moderator with the given display name.
export async function seedModerator(input: {
  username: string;
  modDisplayName: string;
  email?: string;
}): Promise<void> {
  await run(
    `CREATE (u:User { username: $username })
     CREATE (mp:ModerationProfile { displayName: $modDisplayName })
     CREATE (u)-[:MODERATION_PROFILE]->(mp)`,
    input
  );
}

export function mockToken(claims: Record<string, unknown>): string {
  return jwt.sign(claims, "mock-signing-key");
}

// Builds a resolver context for a moderator request.
export function modContext(env: ImageModEnv, token: string) {
  return {
    driver: env.driver,
    ogm: env.ogm,
    req: {
      headers: { authorization: `Bearer ${token}` },
      body: {},
    },
  };
}
