import test from "node:test";
import assert from "node:assert/strict";
import getImageAlbumUsage from "./getImageAlbumUsage.js";

const record = (usage: unknown) => ({
  get: (key: string) => (key === "usage" ? usage : undefined),
});

const createDriver = (records: unknown[]) => {
  const runCalls: Array<{ query: string; params: Record<string, unknown> }> = [];
  let closed = false;

  return {
    driver: {
      session: () => ({
        run: async (query: string, params: Record<string, unknown>) => {
          runCalls.push({ query, params });
          return { records };
        },
        close: async () => {
          closed = true;
        },
      }),
    },
    runCalls,
    isClosed: () => closed,
  };
};

test("getImageAlbumUsage returns grouped uploader and non-uploader albums", async () => {
  const usage = {
    imageId: "image-1",
    uploaderUsername: "alice",
    uploaderOwnedAlbums: [
      {
        id: "album-1",
        imageOrder: ["image-1"],
        Owner: { username: "alice", displayName: "Alice" },
        Discussions: [],
      },
    ],
    otherAlbums: [
      {
        id: "album-2",
        imageOrder: ["image-1"],
        Owner: { username: "bob", displayName: "Bob" },
        Discussions: [{ id: "discussion-1", title: "Bob's remix" }],
      },
    ],
  };
  const { driver, runCalls, isClosed } = createDriver([record(usage)]);
  const resolver = getImageAlbumUsage({ driver: driver as never });

  const result = await resolver(null, { imageId: "image-1" });

  assert.deepEqual(result, usage);
  assert.deepEqual(runCalls[0].params, { imageId: "image-1" });
  assert.equal(isClosed(), true);
});

test("getImageAlbumUsage throws when the image does not exist", async () => {
  const { driver, isClosed } = createDriver([]);
  const resolver = getImageAlbumUsage({ driver: driver as never });

  await assert.rejects(
    () => resolver(null, { imageId: "missing" }),
    /Image not found/
  );
  assert.equal(isClosed(), true);
});

test("getImageAlbumUsage rejects missing image id before querying", async () => {
  const { driver, runCalls } = createDriver([]);
  const resolver = getImageAlbumUsage({ driver: driver as never });

  await assert.rejects(
    () => resolver(null, { imageId: "" }),
    /You must provide an image id/
  );
  assert.equal(runCalls.length, 0);
});
