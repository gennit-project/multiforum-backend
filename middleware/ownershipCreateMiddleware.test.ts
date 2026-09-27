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

const createContext = ({ username, userExists = true }: ContextParams) =>
  ({
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
    ogm: {
      model: (name: string) => {
        if (name !== "User") throw new Error(`Unexpected model lookup: ${name}`);
        return {
          find: async ({ where }: { where: { username?: string } }) =>
            userExists && where.username === username
              ? [{ username, ModerationProfile: null }]
              : [],
        };
      },
    },
  }) as unknown as GraphQLContext;

const recordingResolve = () => {
  const calls: Array<Record<string, unknown>> = [];
  const resolve = async (_parent: unknown, args: Record<string, unknown>) => {
    calls.push(args);
    return { ok: true };
  };
  return { calls, resolve };
};

const connectTo = (username: string) => ({
  connect: { where: { node: { username } } },
});

test("album creation is rejected when signed out, without reaching the resolver", async () => {
  const { calls, resolve } = recordingResolve();
  await assert.rejects(
    forceAlbumOwner(resolve, null, { input: [{}] }, createContext({ username: null }), mockInfo),
    { message: "You must be logged in to create albums." }
  );
  assert.equal(calls.length, 0);
});

test("album creation is rejected when the signed-in user has no account", async () => {
  const { resolve } = recordingResolve();
  await assert.rejects(
    forceAlbumOwner(
      resolve,
      null,
      { input: [{}] },
      createContext({ username: "alice", userExists: false }),
      mockInfo
    ),
    { message: "Could not find the album owner." }
  );
});

test("album owner and nested image uploaders are forced to the signed-in user", async () => {
  const { calls, resolve } = recordingResolve();
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
    createContext({ username: "alice" }),
    mockInfo
  );

  assert.deepEqual(calls[0].input, [
    {
      imageOrder: [],
      Owner: connectTo("alice"),
      Images: {
        create: [{ node: { url: "https://example.com/a.jpg", Uploader: connectTo("alice") } }],
      },
    },
  ]);
});

test("collection creation is rejected when signed out, without reaching the resolver", async () => {
  const { calls, resolve } = recordingResolve();
  await assert.rejects(
    forceCollectionOwner(
      resolve,
      null,
      { input: [{ name: "Favorites" }] },
      createContext({ username: null }),
      mockInfo
    ),
    { message: "You must be logged in to create collections." }
  );
  assert.equal(calls.length, 0);
});

test("collection creator is forced to the signed-in user and visibility defaults to private", async () => {
  const { calls, resolve } = recordingResolve();
  await forceCollectionOwner(
    resolve,
    null,
    { input: [{ name: "Favorites", CreatedBy: connectTo("mallory") }] },
    createContext({ username: "alice" }),
    mockInfo
  );

  assert.deepEqual(calls[0].input, [
    { name: "Favorites", visibility: "PRIVATE", CreatedBy: connectTo("alice") },
  ]);
});

test("the resolver's result is passed through unchanged", async () => {
  const { resolve } = recordingResolve();
  const result = await forceCollectionOwner(
    resolve,
    null,
    { input: [{ name: "Favorites" }] },
    createContext({ username: "alice" }),
    mockInfo
  );
  assert.deepEqual(result, { ok: true });
});
