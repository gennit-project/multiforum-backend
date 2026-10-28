import assert from "node:assert/strict";
import test from "node:test";
import { makeExecutableSchema } from "@graphql-tools/schema";
import type { Driver } from "neo4j-driver";
import { registerGeneratedSchema } from "./generatedSchemaOperations.js";
import { createRoleGuardRepository } from "./roleGuardRepository.js";
import {
  SERVER_ROLE_CAPABILITY_FIELDS,
  MOD_SERVER_ROLE_CAPABILITY_FIELDS,
} from "../../rules/permission/actorCapabilities.js";

const capabilityFields = (fields: readonly string[]) => fields.map((field) => `${field}: Boolean`).join("\n");

test("fixed role snapshots select every guarded capability and preserve filter inputs", async () => {
  const driver = {} as Driver;
  const seen: Array<{ field: string; where: unknown; context: unknown }> = [];
  const schema = makeExecutableSchema({
    typeDefs: `
      type User { username: String! }
      type Channel { uniqueName: String! Admins: [User!]! }
      type ChannelRole { Owner: Channel! }
      type ModChannelRole { Owner: Channel! }
      type ServerRole { ${capabilityFields(SERVER_ROLE_CAPABILITY_FIELDS)} }
      type ModServerRole { ${capabilityFields(MOD_SERVER_ROLE_CAPABILITY_FIELDS)} }
      input StringScalarFilters { eq: String }
      input ChannelWhere { uniqueName: StringScalarFilters }
      input ChannelRoleWhere { OR: [ChannelRoleWhere!] name_CONTAINS: String }
      input ModChannelRoleWhere { name: String }
      input ServerRoleWhere { name: String }
      input ModServerRoleWhere { name: String }
      type Query {
        channels(where: ChannelWhere): [Channel!]!
        channelRoles(where: ChannelRoleWhere): [ChannelRole!]!
        modChannelRoles(where: ModChannelRoleWhere): [ModChannelRole!]!
        serverRoles(where: ServerRoleWhere): [ServerRole!]!
        modServerRoles(where: ModServerRoleWhere): [ModServerRole!]!
      }
    `,
    resolvers: {
      Query: Object.fromEntries([
        ["channels", [{ uniqueName: "cats", Admins: [{ username: "alice" }] }]],
        ["channelRoles", [{ Owner: { uniqueName: "cats" } }]],
        ["modChannelRoles", [{ Owner: { uniqueName: "dogs" } }]],
        ["serverRoles", [Object.fromEntries(SERVER_ROLE_CAPABILITY_FIELDS.map((f) => [f, true]))]],
        ["modServerRoles", [Object.fromEntries(MOD_SERVER_ROLE_CAPABILITY_FIELDS.map((f) => [f, false]))]],
      ].map(([field, value]) => [field, (_parent: unknown, args: { where?: unknown }, context: unknown) => {
        seen.push({ field: field as string, where: args.where, context });
        return value;
      }])),
    },
  });
  registerGeneratedSchema(driver, schema);
  const repository = createRoleGuardRepository(driver);
  assert.deepEqual(JSON.parse(JSON.stringify(await repository.findChannelAdmins("cats"))), [{ Admins: [{ username: "alice" }] }]);
  const where = { OR: [{ name_CONTAINS: "read" }, { name_CONTAINS: "write" }] };
  assert.deepEqual(JSON.parse(JSON.stringify(await repository.findChannelRoleOwners(where))), [{ Owner: { uniqueName: "cats" } }]);
  assert.deepEqual(JSON.parse(JSON.stringify(await repository.findModChannelRoleOwners({ name: "Mod" }))), [{ Owner: { uniqueName: "dogs" } }]);
  const serverRoles = await repository.findServerRoleCapabilities({ name: "Server" });
  const modRoles = await repository.findModServerRoleCapabilities({ name: "Mod" });
  assert.deepEqual(Object.keys(serverRoles[0]), [...SERVER_ROLE_CAPABILITY_FIELDS]);
  assert.deepEqual(Object.keys(modRoles[0]), [...MOD_SERVER_ROLE_CAPABILITY_FIELDS]);
  assert.ok(Object.values(serverRoles[0]).every((value) => value === true));
  assert.ok(Object.values(modRoles[0]).every((value) => value === false));
  assert.deepEqual(seen.map(({ where }) => where), [
    { uniqueName: { eq: "cats" } }, where, { name: "Mod" }, { name: "Server" }, { name: "Mod" },
  ]);
  assert.ok(seen.every(({ context }) => {
    assert.deepEqual(context, { sessionConfig: { database: undefined } });
    return true;
  }));
});

test("an unavailable generated schema rejects every authorization snapshot", async () => {
  const repository = createRoleGuardRepository({} as Driver);
  for (const read of [
    () => repository.findChannelAdmins("cats"),
    () => repository.findChannelRoleOwners({ name: "Reader" }),
    () => repository.findModChannelRoleOwners({ name: "Mod" }),
    () => repository.findServerRoleCapabilities({ name: "Server" }),
    () => repository.findModServerRoleCapabilities({ name: "Mod" }),
  ]) {
    await assert.rejects(read(), /not initialized/);
  }
});
