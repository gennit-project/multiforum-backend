import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLContext } from "../types/context.js";
import {
  attachWikiPageOwner,
  createOwnedChildWikiPages,
  createOwnedWikiHomePage,
  createWikiPagesWithOwners,
} from "./wikiPageOwnershipMiddleware.js";

const info = {} as never;
const resolver = async (
  _parent: unknown,
  args: Record<string, unknown>
) => args;

test("direct wiki creation derives the owner connection from immutable route identity", async () => {
  const result = await createWikiPagesWithOwners(
    resolver as never,
    null,
    { input: [{ title: "Guide", slug: "guide", channelUniqueName: "cats" }] },
    {} as GraphQLContext,
    info
  ) as { input: Array<Record<string, any>> };

  assert.deepEqual(result.input[0].Channel, {
    connect: { where: { node: { uniqueName: "cats" } } },
  });
});

test("nested child pages inherit ownership during direct creation", async () => {
  const result = await createWikiPagesWithOwners(
    resolver as never,
    null,
    {
      input: [{
        title: "Guide", slug: "guide", channelUniqueName: "cats",
        ChildPages: { create: [{ node: { title: "Child", slug: "child" } }] },
      }],
    },
    {} as GraphQLContext,
    info
  ) as { input: Array<Record<string, any>> };
  assert.equal(
    result.input[0].ChildPages.create[0].node.Channel.connect.where.node.uniqueName,
    "cats"
  );
});

test("client-provided ownership cannot disagree with route identity", () => {
  assert.throws(
    () => attachWikiPageOwner({ channelUniqueName: "dogs" }, "cats"),
    /ownership must match/
  );
});

test("wiki creation requires a route channel", () => {
  assert.throws(() => attachWikiPageOwner({}, ""), /channel is required/);
});

test("create middleware handles an omitted input list", async () => {
  const result = await createWikiPagesWithOwners(
    resolver as never, null, {}, {} as GraphQLContext, info
  );
  assert.deepEqual(result, { input: [] });
});

test("child pages inherit the relationship owner of their parent", async () => {
  const context = {
    ogm: {
      model: () => ({
        find: async () => [{ Channel: { uniqueName: "cats" } }],
      }),
    },
  } as unknown as GraphQLContext;
  const result = await createOwnedChildWikiPages(
    resolver as never,
    null,
    {
      where: { id: "parent" },
      update: {
        ChildPages: {
          create: [{ node: { title: "Child", slug: "child" } }],
        },
      },
    },
    context,
    info
  ) as Record<string, any>;

  assert.equal(
    result.update.ChildPages.create[0].node.Channel.connect.where.node.uniqueName,
    "cats"
  );
  assert.equal(result.update.ChildPages.create[0].node.channelUniqueName, "cats");
});

test("child creation refuses ambiguous parent ownership", async () => {
  const context = {
    ogm: {
      model: () => ({
        find: async () => [
          { Channel: { uniqueName: "cats" } },
          { Channel: { uniqueName: "dogs" } },
        ],
      }),
    },
  } as unknown as GraphQLContext;
  await assert.rejects(
    createOwnedChildWikiPages(
      resolver as never,
      null,
      { update: { ChildPages: { create: [{ node: {} }] } } },
      context,
      info
    ),
    /one channel owner/
  );
});

test("child middleware passes through unrelated updates", async () => {
  const args = { where: { id: "parent" }, update: { title: "Changed" } };
  const result = await createOwnedChildWikiPages(
    resolver as never, null, args, {} as GraphQLContext, info
  );
  assert.equal(result, args);
});

test("child middleware supports array-shaped relationship updates", async () => {
  const context = {
    ogm: { model: () => ({ find: async () => [{ Channel: { uniqueName: "cats" } }] }) },
  } as unknown as GraphQLContext;
  const result = await createOwnedChildWikiPages(
    resolver as never,
    null,
    { update: { ChildPages: [{ create: [{ node: { title: "Child", slug: "child" } }] }] } },
    context,
    info
  ) as Record<string, any>;
  assert.equal(result.update.ChildPages[0].create[0].node.channelUniqueName, "cats");
});

test("wiki home page creation is anchored to the updated channel", async () => {
  const result = await createOwnedWikiHomePage(
    resolver as never,
    null,
    {
      where: { uniqueName: "cats" },
      update: {
        WikiHomePage: { create: { node: { title: "Home", slug: "home" } } },
      },
    },
    {} as GraphQLContext,
    info
  ) as Record<string, any>;
  assert.equal(
    result.update.WikiHomePage.create.node.Channel.connect.where.node.uniqueName,
    "cats"
  );
});

test("wiki home middleware passes through updates without creation", async () => {
  const args = { update: { description: "Changed" } };
  const result = await createOwnedWikiHomePage(
    resolver as never, null, args, {} as GraphQLContext, info
  );
  assert.equal(result, args);
});

test("wiki home creation requires one channel uniqueName", async () => {
  await assert.rejects(
    createOwnedWikiHomePage(
      resolver as never,
      null,
      { update: { WikiHomePage: { create: { node: {} } } } },
      {} as GraphQLContext,
      info
    ),
    /single channel uniqueName/
  );
});
