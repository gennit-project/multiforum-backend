import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLContext } from "../types/context.js";
import {
  attachChannelRoleOwner,
  createChannelRolesWithOwners,
  createChannelsWithOwnedRoles,
  getConnectedOwnerChannelNames,
  updateChannelRolesWithoutOwnerChanges,
  updateChannelsWithOwnedRoles,
} from "./channelRoleOwnershipMiddleware.js";

const info = {} as never;
const resolver = async (
  _parent: unknown,
  args: Record<string, unknown>
) => args;
const owner = (uniqueName: string) => ({
  connect: { where: { node: { uniqueName } } },
});

test("reads exactly the channels named by Owner connect inputs", () => {
  assert.deepEqual(getConnectedOwnerChannelNames(owner("cats")), ["cats"]);
  assert.deepEqual(
    getConnectedOwnerChannelNames({
      connect: [
        { where: { node: { uniqueName: "cats" } } },
        { where: { node: { uniqueName: "dogs" } } },
      ],
    }).sort(),
    ["cats", "dogs"]
  );
  assert.deepEqual(getConnectedOwnerChannelNames({ connect: [
    { where: { node: "not-an-object" } },
    { where: { node: { uniqueName: "  " } } },
  ] }), []);
});

test("role identity is derived from the explicit owner connection", () => {
  const result = attachChannelRoleOwner({
    name: "Reader",
    channelUniqueName: "cats",
    Owner: owner("cats"),
  });
  assert.equal(result.channelUniqueName, "cats");
  assert.deepEqual(result.Owner, owner("cats"));
});

test("role creation rejects missing, multiple, and mismatched owners", () => {
  assert.throws(() => attachChannelRoleOwner({ name: "Reader" }), /owning channel/);
  assert.throws(
    () => attachChannelRoleOwner({
      name: "Reader",
      Owner: {
        connect: [
          { where: { node: { uniqueName: "cats" } } },
          { where: { node: { uniqueName: "dogs" } } },
        ],
      },
    }),
    /exactly one/
  );
  assert.throws(
    () => attachChannelRoleOwner({
      name: "Reader",
      channelUniqueName: "dogs",
      Owner: owner("cats"),
    }),
    /match channelUniqueName/
  );
  assert.throws(
    () => attachChannelRoleOwner(
      { name: "Reader", Owner: owner("dogs") },
      "cats"
    ),
    /match the channel receiving/
  );
});

test("direct user and moderator role creation normalizes ownership", async () => {
  const result = await createChannelRolesWithOwners(
    resolver as never,
    null,
    { input: [{ name: "Reader", Owner: owner("cats") }] },
    {} as GraphQLContext,
    info
  ) as Record<string, any>;
  assert.equal(result.input[0].channelUniqueName, "cats");
});

test("nested roles inherit the channel being created", async () => {
  const result = await createChannelsWithOwnedRoles(
    resolver as never,
    null,
    {
      input: [{
        uniqueName: "cats",
        DefaultChannelRole: { create: { node: { name: "Reader" } } },
        DefaultModRole: { create: { node: { name: "Moderator" } } },
      }],
    },
    {} as GraphQLContext,
    info
  ) as Record<string, any>;
  assert.equal(
    result.input[0].DefaultChannelRole.create.node.Owner.connect.where.node.uniqueName,
    "cats"
  );
  assert.equal(
    result.input[0].DefaultModRole.create.node.channelUniqueName,
    "cats"
  );
});

test("channel role connections are scoped and checked against relationship ownership", async () => {
  const finds: Record<string, unknown>[] = [];
  const context = {
    roleGuardRepository: {
        findChannelRoleOwners: async (where: Record<string, unknown>) => {
          finds.push(where);
          return [{ Owner: { uniqueName: "cats" } }];
        },
    },
  } as unknown as GraphQLContext;
  const result = await updateChannelsWithOwnedRoles(
    resolver as never,
    null,
    {
      where: { uniqueName: "cats" },
      update: {
        DefaultChannelRole: {
          connect: { where: { node: { name: "Reader" } }, overwrite: true },
        },
      },
    },
    context,
    info
  ) as Record<string, any>;

  assert.deepEqual(finds, [{ name: "Reader", channelUniqueName: "cats" }]);
  assert.equal(
    result.update.DefaultChannelRole.connect.where.node.channelUniqueName,
    "cats"
  );
});

test("a role owned by another channel cannot be attached", async () => {
  const context = {
    roleGuardRepository: {
      findModChannelRoleOwners: async () => [{ Owner: { uniqueName: "dogs" } }],
    },
  } as unknown as GraphQLContext;
  await assert.rejects(
    updateChannelsWithOwnedRoles(
      resolver as never,
      null,
      {
        where: { uniqueName: "cats" },
        update: {
          ElevatedModRole: {
            connect: { where: { node: { name: "Moderator" } } },
          },
        },
      },
      context,
      info
    ),
    /only be attached to its owning channel/
  );

  const ownerlessContext = {
    roleGuardRepository: { findModChannelRoleOwners: async () => [{ Owner: null }] },
  } as unknown as GraphQLContext;
  await assert.rejects(
    updateChannelsWithOwnedRoles(
      resolver as never,
      null,
      {
        where: { uniqueName: "cats" },
        update: {
          DefaultModRole: {
            connect: { where: { node: { id: "ownerless" } } },
          },
        },
      },
      ownerlessContext,
      info
    ),
    /only be attached to its owning channel/
  );

  const missingContext = {
    roleGuardRepository: { findChannelRoleOwners: async () => [] },
  } as unknown as GraphQLContext;
  await assert.rejects(
    updateChannelsWithOwnedRoles(
      resolver as never,
      null,
      {
        where: { uniqueName: "cats" },
        update: {
          DefaultChannelRole: {
            connect: { where: { node: { id: "missing" } } },
          },
        },
      },
      missingContext,
      info
    ),
    /only be attached to its owning channel/
  );
});

test("role-changing channel updates require one exact channel identity", async () => {
  await assert.rejects(
    updateChannelsWithOwnedRoles(
      resolver as never,
      null,
      { where: {}, update: { SuspendedRole: { create: { node: { name: "Nope" } } } } },
      {} as GraphQLContext,
      info
    ),
    /single channel uniqueName/
  );
});

test("nested role owner rewrites and unscopable connectOrCreate are rejected", async () => {
  await assert.rejects(
    updateChannelsWithOwnedRoles(
      resolver as never,
      null,
      {
        where: { uniqueName: "cats" },
        update: {
          DefaultChannelRole: {
            update: { node: { Owner: { disconnect: true } } },
          },
        },
      },
      {} as GraphQLContext,
      info
    ),
    /cannot be changed/
  );
  await assert.rejects(
    updateChannelsWithOwnedRoles(
      resolver as never,
      null,
      {
        where: { uniqueName: "cats" },
        update: {
          DefaultChannelRole: {
            connectOrCreate: {
              where: { node: { id: "role-id" } },
              onCreate: { node: { name: "Reader", channelUniqueName: "cats" } },
            },
          },
        },
      },
      {} as GraphQLContext,
      info
    ),
    /connectOrCreate is not supported/
  );
});

test("unrelated channel updates pass through unchanged", async () => {
  const args = { where: { uniqueName: "cats" }, update: { description: "Changed" } };
  assert.equal(
    await updateChannelsWithOwnedRoles(
      resolver as never,
      null,
      args,
      {} as GraphQLContext,
      info
    ),
    args
  );
});

test("direct role updates cannot change the owning channel", async () => {
  await assert.rejects(
    updateChannelRolesWithoutOwnerChanges(
      resolver as never,
      null,
      { where: { id: "role-id" }, connect: { Owner: owner("dogs") } },
      {} as GraphQLContext,
      info
    ),
    /cannot be changed/
  );
  await assert.rejects(
    updateChannelRolesWithoutOwnerChanges(
      resolver as never,
      null,
      { where: { id: "role-id" }, update: { Owner: { disconnect: true } } },
      {} as GraphQLContext,
      info
    ),
    /cannot be changed/
  );
  await assert.rejects(
    updateChannelRolesWithoutOwnerChanges(
      resolver as never,
      null,
      { where: { id: "role-id" }, delete: { Owner: {} } },
      {} as GraphQLContext,
      info
    ),
    /cannot be changed/
  );
});

test("direct role capability updates pass through unchanged", async () => {
  const args = {
    where: { id: "role-id" },
    update: { canCreateDiscussion: true },
  };
  assert.equal(
    await updateChannelRolesWithoutOwnerChanges(
      resolver as never,
      null,
      args,
      {} as GraphQLContext,
      info
    ),
    args
  );
});
