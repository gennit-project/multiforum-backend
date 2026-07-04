import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import type { GraphQLContext } from "../../types/context.js";
import {
  addImageToAlbum,
  removeImageFromAlbum,
} from "./albumImageReuse.js";

process.env.PLAYWRIGHT_MOCK_AUTH = "true";

const statusRecord = (status: string) => ({
  get: (key: string) => (key === "status" ? status : undefined),
});

const createDriver = (records: unknown[]) => {
  const runCalls: Array<{ query: string; params: Record<string, unknown> }> = [];
  const sessionCalls: Array<Record<string, unknown> | undefined> = [];
  let closed = false;

  return {
    driver: {
      session: (options?: Record<string, unknown>) => {
        sessionCalls.push(options);
        return {
          run: async (query: string, params: Record<string, unknown>) => {
            runCalls.push({ query, params });
            return { records };
          },
          close: async () => {
            closed = true;
          },
        };
      },
    },
    runCalls,
    sessionCalls,
    isClosed: () => closed,
  };
};

const createMockContext = (username: string | null = null) =>
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
        if (name === "User") {
          return {
            find: async () => [
              {
                ModerationProfile: {
                  displayName: username ? `mod-${username}` : null,
                },
              },
            ],
          };
        }
        throw new Error(`Unexpected model lookup: ${name}`);
      },
    },
  } as unknown as GraphQLContext);

test("addImageToAlbum connects an active image to an owned album", async () => {
  const { driver, runCalls, sessionCalls, isClosed } = createDriver([
    statusRecord("OK"),
  ]);
  const resolver = addImageToAlbum({ driver: driver as never });

  const result = await resolver(
    null,
    { albumId: "album-1", imageId: "image-1", position: 1 },
    createMockContext("alice")
  );

  assert.equal(result, true);
  assert.deepEqual(runCalls[0].params, {
    albumId: "album-1",
    imageId: "image-1",
    position: 1,
    username: "alice",
  });
  assert.match(runCalls[0].query, /coalesce\(image\.archived, false\)/);
  assert.match(runCalls[0].query, /MERGE \(album\)-\[:HAS_IMAGE\]->\(image\)/);
  assert.deepEqual(sessionCalls[0], { defaultAccessMode: "WRITE" });
  assert.equal(isClosed(), true);
});

test("addImageToAlbum appends when position is omitted", async () => {
  const { driver, runCalls } = createDriver([statusRecord("OK")]);
  const resolver = addImageToAlbum({ driver: driver as never });

  await resolver(
    null,
    { albumId: "album-1", imageId: "image-1" },
    createMockContext("alice")
  );

  assert.equal(runCalls[0].params.position, null);
});

test("addImageToAlbum rejects non-owner album updates", async () => {
  const { driver, isClosed } = createDriver([statusRecord("NOT_OWNER")]);
  const resolver = addImageToAlbum({ driver: driver as never });

  await assert.rejects(
    () =>
      resolver(
        null,
        { albumId: "album-1", imageId: "image-1" },
        createMockContext("mallory")
      ),
    /You must be the owner of this album/
  );
  assert.equal(isClosed(), true);
});

test("addImageToAlbum rejects duplicate membership", async () => {
  const { driver } = createDriver([statusRecord("ALREADY_IN_ALBUM")]);
  const resolver = addImageToAlbum({ driver: driver as never });

  await assert.rejects(
    () =>
      resolver(
        null,
        { albumId: "album-1", imageId: "image-1" },
        createMockContext("alice")
      ),
    /Image is already in this album/
  );
});

test("addImageToAlbum rejects archived or missing images", async () => {
  const { driver } = createDriver([statusRecord("IMAGE_NOT_FOUND")]);
  const resolver = addImageToAlbum({ driver: driver as never });

  await assert.rejects(
    () =>
      resolver(
        null,
        { albumId: "album-1", imageId: "image-1" },
        createMockContext("alice")
      ),
    /Image not found/
  );
});

test("addImageToAlbum rejects missing auth before querying", async () => {
  const { driver, runCalls } = createDriver([]);
  const resolver = addImageToAlbum({ driver: driver as never });

  await assert.rejects(
    () =>
      resolver(
        null,
        { albumId: "album-1", imageId: "image-1" },
        createMockContext(null)
      ),
    /You must be logged in to update albums/
  );
  assert.equal(runCalls.length, 0);
});

test("removeImageFromAlbum disconnects an image and prunes imageOrder", async () => {
  const { driver, runCalls, isClosed } = createDriver([statusRecord("OK")]);
  const resolver = removeImageFromAlbum({ driver: driver as never });

  const result = await resolver(
    null,
    { albumId: "album-1", imageId: "image-1" },
    createMockContext("alice")
  );

  assert.equal(result, true);
  assert.deepEqual(runCalls[0].params, {
    albumId: "album-1",
    imageId: "image-1",
    username: "alice",
  });
  assert.match(runCalls[0].query, /DELETE relationship/);
  assert.match(runCalls[0].query, /SET album\.imageOrder/);
  assert.equal(isClosed(), true);
});

test("removeImageFromAlbum rejects non-owner album updates", async () => {
  const { driver } = createDriver([statusRecord("NOT_OWNER")]);
  const resolver = removeImageFromAlbum({ driver: driver as never });

  await assert.rejects(
    () =>
      resolver(
        null,
        { albumId: "album-1", imageId: "image-1" },
        createMockContext("mallory")
      ),
    /You must be the owner of this album/
  );
});

test("removeImageFromAlbum validates ids before querying", async () => {
  const { driver, runCalls } = createDriver([]);
  const resolver = removeImageFromAlbum({ driver: driver as never });

  await assert.rejects(
    () =>
      resolver(
        null,
        { albumId: "", imageId: "image-1" },
        createMockContext("alice")
      ),
    /You must provide an album id/
  );
  assert.equal(runCalls.length, 0);
});
