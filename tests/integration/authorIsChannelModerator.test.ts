// Verifies the membership-derived `authorIsChannelModerator` @cypher field on
// Discussion (the replacement for the legacy ChannelRole.showModTag MOD badge).
// The flag must be true when the content author is a channel owner
// (ADMIN_OF_CHANNEL) or a channel moderator (MODERATION_PROFILE ->
// MODERATOR_OF_CHANNEL), and false otherwise. See docs/isadmin-phaseout-design.md.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { graphql, type GraphQLSchema } from "graphql";
import type { Driver } from "neo4j-driver";
import { Neo4jContainer, StartedNeo4jContainer } from "@testcontainers/neo4j";

const SERVER_CONFIG_NAME = "ModTagTestServer";
const CHANNEL = "cats";

let container: StartedNeo4jContainer;
let schema: GraphQLSchema;
let driver: Driver;
let ogm: any;

before(async () => {
  container = await new Neo4jContainer("neo4j:5-community").withApoc().start();
  process.env.NEO4J_URI = container.getBoltUri();
  process.env.NEO4J_USER = container.getUsername();
  process.env.NEO4J_PASSWORD = container.getPassword();
  process.env.SERVER_CONFIG_NAME = SERVER_CONFIG_NAME;

  const { buildPermissionedSchema } = await import(
    "../helpers/buildPermissionedSchema.js"
  );
  ({ schema, driver, ogm } = await buildPermissionedSchema());
  await ogm.init();

  const session = driver.session();
  try {
    await session.run("CREATE (:Channel { uniqueName: $ch })", { ch: CHANNEL });

    // Owner: ADMIN_OF_CHANNEL
    await session.run(
      `MATCH (ch:Channel { uniqueName: $ch })
       CREATE (u:User { username: 'owner' })-[:ADMIN_OF_CHANNEL]->(ch)
       CREATE (u)-[:POSTED_DISCUSSION]->(:Discussion { id: 'd-owner', title: 'o' })`,
      { ch: CHANNEL }
    );

    // Moderator: MODERATION_PROFILE -> MODERATOR_OF_CHANNEL
    await session.run(
      `MATCH (ch:Channel { uniqueName: $ch })
       CREATE (u:User { username: 'mod' })-[:MODERATION_PROFILE]->(mp:ModerationProfile { displayName: 'mod-prof' })
       CREATE (mp)-[:MODERATOR_OF_CHANNEL]->(ch)
       CREATE (u)-[:POSTED_DISCUSSION]->(:Discussion { id: 'd-mod', title: 'm' })`,
      { ch: CHANNEL }
    );

    // Regular user: no channel role
    await session.run(
      `CREATE (u:User { username: 'regular' })
       CREATE (u)-[:POSTED_DISCUSSION]->(:Discussion { id: 'd-regular', title: 'r' })`
    );
  } finally {
    await session.close();
  }
}, { timeout: 240000 });

after(async () => {
  await driver?.close();
  await container?.stop();
});

const QUERY = /* GraphQL */ `
  query ($id: ID!, $channelUniqueName: String) {
    discussions(where: { id: $id }) {
      id
      authorIsChannelModerator(channelUniqueName: $channelUniqueName)
    }
  }
`;

const run = async (id: string, channelUniqueName: string | null) => {
  const result = await graphql({
    schema,
    source: QUERY,
    contextValue: { driver, ogm, req: { headers: {} } },
    variableValues: { id, channelUniqueName },
  });
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  const data = result.data as any;
  return data?.discussions?.[0]?.authorIsChannelModerator;
};

test("channel owner's discussion -> authorIsChannelModerator true", async () => {
  assert.equal(await run("d-owner", CHANNEL), true);
});

test("channel moderator's discussion -> authorIsChannelModerator true", async () => {
  assert.equal(await run("d-mod", CHANNEL), true);
});

test("regular user's discussion -> authorIsChannelModerator false", async () => {
  assert.equal(await run("d-regular", CHANNEL), false);
});

test("a different channel does not grant the badge", async () => {
  assert.equal(await run("d-owner", "dogs"), false);
});

test("null channelUniqueName -> false", async () => {
  assert.equal(await run("d-owner", null), false);
});
