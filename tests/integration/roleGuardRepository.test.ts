import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import type { GraphQLResolveInfo } from "graphql";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import type { GraphQLContext } from "../../types/context.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createRoleGuardRepository } from "../../services/persistence/roleGuardRepository.js";
import { SERVER_ROLE_CAPABILITY_FIELDS, MOD_SERVER_ROLE_CAPABILITY_FIELDS } from "../../rules/permission/actorCapabilities.js";
import { updateChannelsWithOwnedRoles } from "../../middleware/channelRoleOwnershipMiddleware.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

let driver: Driver;
before(async () => {
  driver = await startNeo4j();
  const app = getCustomResolvers(driver);
  const neoSchema = new Neo4jGraphQL({
    typeDefs, driver, resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: true },
  });
  const schema = await neoSchema.getSchema();
  registerGeneratedSchema(driver, schema);
}, { timeout: 240_000 });
beforeEach(async () => resetDatabase(driver));
after(async () => stopNeo4j());
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const errorMessage = async (read: () => Promise<unknown>): Promise<string> => {
  try { await read(); assert.fail("expected error"); }
  catch (error) { assert.equal((error as Error).constructor, Error); return (error as Error).message; }
};

async function seedRoles(): Promise<void> {
  await driver.executeQuery(`
    CREATE (cats:Channel {uniqueName: 'cats'})
    CREATE (dogs:Channel {uniqueName: 'dogs'})
    CREATE (alice:User {username: 'alice'})-[:ADMIN_OF_CHANNEL]->(cats)
    CREATE (bob:User {username: 'bob'})-[:ADMIN_OF_CHANNEL]->(dogs)
    CREATE (cats)-[:OWNS_CHANNEL_ROLE]->(:ChannelRole {id: 'reader', name: 'Reader', channelUniqueName: 'cats'})
    CREATE (dogs)-[:OWNS_CHANNEL_ROLE]->(:ChannelRole {id: 'writer', name: 'Writer', channelUniqueName: 'dogs'})
    CREATE (cats)-[:OWNS_MOD_CHANNEL_ROLE]->(:ModChannelRole {id: 'mod-cats', name: 'Mod', channelUniqueName: 'cats'})
    CREATE (dogs)-[:OWNS_MOD_CHANNEL_ROLE]->(:ModChannelRole {id: 'mod-dogs', name: 'Mod', channelUniqueName: 'dogs'})
    CREATE (:ServerRole {name: 'low', canCreateComment: true})
    CREATE (:ServerRole {name: 'high', canManageAdmins: true, canCreateComment: false})
    CREATE (:ModServerRole {name: 'low', canReport: false})
    CREATE (:ModServerRole {name: 'high', canReport: true, canRemoveDiscussionChannel: true})
  `);
}

test("role owner filters preserve nested relations, OR/NOT, omitted filters and exact admin snapshots", async (t) => {
  await seedRoles();
  const repository = createRoleGuardRepository(driver);
  for (const where of [undefined, {}, { OR: [{ name: { contains: "Read" } }, { name: { eq: "Writer" } }] }, { Owner: { uniqueName: { eq: "cats" } }, NOT: { name: { eq: "missing" } } }, { name: { eq: "absent" } }]) {
    t.assert.snapshot(plain(await repository.findChannelRoleOwners(where)));
  }
  for (const where of [undefined, { OR: [{ channelUniqueName: { eq: "cats" } }, { Owner: { uniqueName: { eq: "dogs" } } }] }, { name: { eq: "absent" } }]) {
    t.assert.snapshot(plain(await repository.findModChannelRoleOwners(where)));
  }
  for (const uniqueName of ["cats", "dogs", "missing"]) {
    t.assert.snapshot(plain(await repository.findChannelAdmins(uniqueName)));
  }
});

test("server capability filters retain every guarded flag and nullable values", async (t) => {
  await seedRoles();
  const repository = createRoleGuardRepository(driver);
  for (const where of [{ OR: [{ name: { eq: "low" } }, { canManageAdmins: { eq: true } }] }, { name: { eq: "missing" } }]) {
    t.assert.snapshot(plain(await repository.findServerRoleCapabilities(where)));
  }
  for (const where of [{ NOT: { name: { eq: "missing" } } }, { canRemoveDiscussionChannel: { eq: true } }]) {
    t.assert.snapshot(plain(await repository.findModServerRoleCapabilities(where)));
  }
});

test("invalid filters and corrupt owners retain OGM's first failure instead of granting access", async () => {
  const repository = createRoleGuardRepository(driver);
  const where = { name: { eq: 42 }, unknownFilter: true };
  await assert.rejects(repository.findChannelRoleOwners(where), /String cannot represent a non string value/);
  await driver.executeQuery("CREATE (:ChannelRole {id: 'orphan', name: 'Orphan', channelUniqueName: 'cats'})");
  await assert.rejects(repository.findChannelRoleOwners({ id: { eq: "orphan" } }), /Cannot return null for non-nullable field ChannelRole\.Owner/);
});

test("relationship middleware scopes arbitrary filters and rejects mismatched owners before resolving", async () => {
  await seedRoles();
  // The scalar matches the receiving channel, but the actual owner is dogs.
  await driver.executeQuery("MATCH (role:ChannelRole {id: 'writer'}) SET role.channelUniqueName = 'cats'");
  const context = { driver } as GraphQLContext;
  const info = {} as GraphQLResolveInfo;
  let calls = 0;
  const resolve = async (_parent: unknown, args: Record<string, unknown>) => { calls++; return args; };
  const update = { DefaultChannelRole: { connect: { where: { node: { OR: [{ name: "Reader" }, { name: "Writer" }] } } } } };
  await assert.rejects(updateChannelsWithOwnedRoles(resolve, null, { where: { uniqueName: "cats" }, update }, context, info), /only be attached to its owning channel/);
  assert.equal(calls, 0);
  const result = await updateChannelsWithOwnedRoles(resolve, null, {
    where: { uniqueName: "cats" }, update: { DefaultChannelRole: { connect: { where: { node: { name_CONTAINS: "Read" } } } } },
  }, context, info) as { update: { DefaultChannelRole: { connect: { where: { node: unknown } } } } };
  assert.equal(calls, 1);
  assert.deepEqual(result.update.DefaultChannelRole.connect.where.node, { name_CONTAINS: "Read", channelUniqueName: "cats" });
});
