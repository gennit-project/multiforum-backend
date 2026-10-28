import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../types/context.js";
import {
  forceAlbumOwner,
  forceCollectionOwner,
} from "./ownershipCreateMiddleware.js";

process.env.PLAYWRIGHT_MOCK_AUTH = "true";

const mockInfo = null as unknown as GraphQLResolveInfo;

type ContextParams = {
  username: string | null;
  userExists?: boolean;
};

// FAMILY-3 / v7: ownership is wired by an owned post-create write (an
// executeQuery against context.driver), so the context carries a recording
// driver and the tests assert both the stripped input reaching the generated
// mutation and the owner-edge query.
const createContext = ({ username, userExists = true }: ContextParams) => {
  const driverCalls: Array<{ cypher: string; params: Record<string, unknown> }> = [];
  const context = {
    driver: {
      executeQuery: async (cypher: string, params: Record<string, unknown>) => {
        driverCalls.push({ cypher, params });
        return { records: [] };
      },
    },
    req: {
      headers: username
        ? {
            authorization: `Bearer ${jwt.sign(
              { email: `${username}@example.com`, username },
              "test-secret"
            )}`,
          }
        : {},
    },
    requestIdentityRepository: {
      findByUsername: async () => null,
      findByEmail: async () => null,
      userExists: async (candidate: string) =>
        userExists && candidate === username,
    },
  } as unknown as GraphQLContext;
  return { context, driverCalls };
};

const recordingResolve = (result: unknown) => {
  const calls: Array<Record<string, unknown>> = [];
  const resolve = async (_parent: unknown, args: Record<string, unknown>) => {
    calls.push(args);
    return result;
  };
  return { calls, resolve };
};

const connectTo = (username: string) => ({
  connect: { where: { node: { username } } },
});

test("album creation is rejected when signed out, without reaching the resolver", async () => {
  const { calls, resolve } = recordingResolve({ albums: [] });
  const { context, driverCalls } = createContext({ username: null });
  await assert.rejects(
    forceAlbumOwner(resolve, null, { input: [{}] }, context, mockInfo),
    { message: "You must be logged in to create albums." }
  );
  assert.equal(calls.length, 0);
  assert.equal(driverCalls.length, 0);
});

test("album creation is rejected when the signed-in user has no account", async () => {
  const { resolve } = recordingResolve({ albums: [] });
  const { context } = createContext({ username: "alice", userExists: false });
  await assert.rejects(
    forceAlbumOwner(resolve, null, { input: [{}] }, context, mockInfo),
    { message: "Could not find the album owner." }
  );
});

test("album owner connects are stripped before the generated create and wired by an owned write", async () => {
  const { calls, resolve } = recordingResolve({ albums: [{ id: "album-1" }] });
  const { context, driverCalls } = createContext({ username: "alice" });
  await forceAlbumOwner(
    resolve,
    null,
    {
      input: [
        {
          imageOrder: [],
          Owner: connectTo("mallory"),
          Images: {
            create: [{ node: { url: "https://example.com/a.jpg", Uploader: connectTo("mallory") } }],
          },
        },
      ],
    },
    context,
    mockInfo
  );

  // The generated create receives scalars + the to-many Images.create, but no
  // to-one Owner / Uploader connects.
  assert.deepEqual(calls[0].input, [
    {
      imageOrder: [],
      Images: {
        create: [{ node: { url: "https://example.com/a.jpg" } }],
      },
    },
  ]);
  // Ownership is applied by the owned post-create write, keyed on the created id.
  assert.equal(driverCalls.length, 1);
  assert.deepEqual(driverCalls[0].params, { ids: ["album-1"], username: "alice" });
  assert.match(driverCalls[0].cypher, /HAS_ALBUM/);
  assert.match(driverCalls[0].cypher, /UPLOADED_IMAGE/);
});

test("collection creation is rejected when signed out, without reaching the resolver", async () => {
  const { calls, resolve } = recordingResolve({ collections: [] });
  const { context } = createContext({ username: null });
  await assert.rejects(
    forceCollectionOwner(resolve, null, { input: [{ name: "Favorites" }] }, context, mockInfo),
    { message: "You must be logged in to create collections." }
  );
  assert.equal(calls.length, 0);
});

test("collection creator is wired by an owned write and visibility defaults to private", async () => {
  const { calls, resolve } = recordingResolve({ collections: [{ id: "collection-1" }] });
  const { context, driverCalls } = createContext({ username: "alice" });
  await forceCollectionOwner(
    resolve,
    null,
    { input: [{ name: "Favorites", CreatedBy: connectTo("mallory") }] },
    context,
    mockInfo
  );

  // CreatedBy stripped before the generated create; visibility default preserved.
  assert.deepEqual(calls[0].input, [{ name: "Favorites", visibility: "PRIVATE" }]);
  assert.equal(driverCalls.length, 1);
  assert.deepEqual(driverCalls[0].params, { ids: ["collection-1"], username: "alice" });
  assert.match(driverCalls[0].cypher, /CREATED_BY/);
});

test("the resolver's result is passed through unchanged", async () => {
  const { resolve } = recordingResolve({ collections: [{ id: "collection-1" }] });
  const { context } = createContext({ username: "alice" });
  const result = await forceCollectionOwner(
    resolve,
    null,
    { input: [{ name: "Favorites" }] },
    context,
    mockInfo
  );
  assert.deepEqual(result, { collections: [{ id: "collection-1" }] });
});
