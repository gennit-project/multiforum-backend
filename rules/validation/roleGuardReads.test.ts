import assert from "node:assert/strict";
import test from "node:test";
import { allow } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import type { RoleGuardRepository, RoleOwnerSnapshot } from "../../services/persistence/roleGuardRepository.js";
import { channelRoleTargetIsOwned, modChannelRoleTargetIsOwned, channelRoleInputDoesNotEscalate } from "./channelRoleEscalation.js";
import { serverConfigInputDoesNotEscalate } from "./nestedRoleEscalation.js";

const options = { debug: false, allowExternalErrors: true, fallbackRule: allow, hashFunction: JSON.stringify };
const info = {} as GraphQLResolveInfo;
const unexpected = async (): Promise<never> => { throw new Error("unexpected read"); };
const repository = (overrides: Partial<RoleGuardRepository>): RoleGuardRepository => ({
  findChannelAdmins: unexpected,
  findChannelRoleOwners: unexpected,
  findModChannelRoleOwners: unexpected,
  findServerRoleCapabilities: unexpected,
  findModServerRoleCapabilities: unexpected,
  ...overrides,
});
const context = (roleGuardRepository: RoleGuardRepository) => ({
  driver: {},
  user: { username: "alice", email: null, data: {} },
  permissionServerConfigRepository: { findByName: async () => null },
  roleGuardRepository,
  _shield: { cache: {} },
} as unknown as GraphQLContext & { _shield: { cache: Record<string, never> } });

for (const [name, rule, method] of [
  ["channel", channelRoleTargetIsOwned, "findChannelRoleOwners"],
  ["moderator", modChannelRoleTargetIsOwned, "findModChannelRoleOwners"],
] as const) {
  for (const [description, owners, expected] of [
    ["all owned targets", [{ Owner: { uniqueName: "cats" } }, { Owner: { uniqueName: "dogs" } }], true],
    ["missing targets", [], "Channel role not found."],
    ["mixed owned/unowned targets", [{ Owner: { uniqueName: "cats" } }, { Owner: { uniqueName: "other" } }], "You can only change channel roles owned by a channel you own."],
    ["missing owner", [{ Owner: null }], "You can only change channel roles owned by a channel you own."],
  ] as Array<[string, RoleOwnerSnapshot[], boolean | string]>) {
    test(`${name} target guard preserves ${description}`, async () => {
      const where = { OR: [{ name_CONTAINS: "Editor" }, { name_CONTAINS: "Reader" }] };
      const ctx = context(repository({
        [method]: async (actual: unknown) => { assert.deepEqual(actual, where); return owners; },
        findChannelAdmins: async (name) => [{ Admins: [{ username: name === "other" ? "bob" : "alice" }] }],
      }));
      const result = await rule.resolve({}, { where }, ctx, info, options);
      if (typeof expected === "string") {
        assert.ok(result instanceof Error);
        assert.equal(result.message, expected);
      } else assert.equal(result, expected);
    });
  }
  test(`${name} target guard fails closed on lookup failure`, async () => {
    assert.equal(await rule.resolve({}, { where: {} }, context(repository({})), info, options), false);
  });
}

test("role authoring reads channel admins and requires ownership of every input", async () => {
  const ctx = context(repository({ findChannelAdmins: async (name) => [{ Admins: [{ username: name === "cats" ? "alice" : "bob" }] }] }));
  const result = await channelRoleInputDoesNotEscalate.resolve({}, { input: ["cats", "dogs"].map((uniqueName) => ({
    Owner: { connect: { where: { node: { uniqueName } } } },
  })) }, ctx, info, options);
  assert.ok(result instanceof Error);
  assert.equal(result.message, "You can only author channel roles for a channel you own.");
});

test("nested connect filters run sequentially and reject capabilities the caller lacks", async () => {
  const reads: string[] = [];
  const ctx = context(repository({
    findServerRoleCapabilities: async (where) => { reads.push(String(where?.name)); return [{ canManageRoles: true }]; },
    findModServerRoleCapabilities: async (where) => { reads.push(String(where?.name)); return [{ canReport: true }]; },
  }));
  const result = await serverConfigInputDoesNotEscalate.resolve({}, { update: {
    DefaultServerRole: { connect: [{ where: { node: { name: "one" } } }, { where: { node: { name: "two" } } }] },
    DefaultModRole: { connect: { where: { node: { name: "three" } } } },
  } }, ctx, info, options);
  assert.deepEqual(reads, ["one", "two", "three"]);
  assert.ok(result instanceof Error);
  assert.equal(result.message, "You cannot grant capabilities you do not have yourself: canManageRoles, canReport.");
});

test("nested connect lookup failure fails closed and does not continue to later filters", async () => {
  let laterReads = 0;
  const ctx = context(repository({ findModServerRoleCapabilities: async () => { laterReads++; return []; } }));
  assert.equal(await serverConfigInputDoesNotEscalate.resolve({}, { update: {
    DefaultServerRole: { connect: { where: { node: { name: "broken" } } } },
    DefaultModRole: { connect: { where: { node: { name: "later" } } } },
  } }, ctx, info, options), false);
  assert.equal(laterReads, 0);
});
