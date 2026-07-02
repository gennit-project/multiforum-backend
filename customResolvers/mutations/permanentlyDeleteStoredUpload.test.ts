import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import getResolver from "./permanentlyDeleteStoredUpload.js";

type TargetRecord = {
  id?: string;
  permanentlyRemoved?: boolean;
  storageBucket?: string | null;
  storageObjectName?: string | null;
  uploadedByUsername?: string | null;
  uploaderUsername?: string | null;
  discussionAuthorUsernames?: string[];
};

const buildRecord = (values: Record<string, unknown>) => ({
  keys: Object.keys(values),
  get: (key: string) => values[key],
});

const buildDriver = ({
  target,
}: {
  target: TargetRecord | null;
}) => {
  const calls = {
    sessions: [] as string[],
    writes: [] as Record<string, unknown>[],
  };

  const driver = {
    session: ({ defaultAccessMode }: { defaultAccessMode: string }) => {
      calls.sessions.push(defaultAccessMode);
      return {
        run: async (query: string, params: Record<string, unknown>) => {
          if (defaultAccessMode === "READ") {
            return {
              records: target
                ? [
                    buildRecord({
                      id: target.id || "target-1",
                      permanentlyRemoved: target.permanentlyRemoved || false,
                      storageBucket:
                        target.storageBucket === undefined
                          ? "bucket"
                          : target.storageBucket,
                      storageObjectName:
                        target.storageObjectName === undefined
                          ? "uploads/alice/file.stl"
                          : target.storageObjectName,
                      uploadedByUsername:
                        target.uploadedByUsername === undefined
                          ? "alice"
                          : target.uploadedByUsername,
                      uploaderUsername: target.uploaderUsername || null,
                      discussionAuthorUsernames:
                        target.discussionAuthorUsernames || [],
                    }),
                  ]
                : [],
            };
          }

          calls.writes.push({ query, params });
          return {
            records: [
              buildRecord({
                id: params.id,
                url: "https://storage.example/file.stl",
                fileName: "file.stl",
                kind: "STL",
                size: 100,
                storageBucket: "bucket",
                storageObjectName: "uploads/alice/file.stl",
                storageUrl: "https://storage.example/file.stl",
                permanentlyRemoved: true,
                permanentlyRemovedAt: "2026-07-01T12:00:00.000Z",
              }),
            ],
          };
        },
        close: async () => undefined,
      };
    },
  };

  return { driver: driver as unknown as Driver, calls };
};

const contextFor = (username: string, modProfileName?: string): GraphQLContext =>
  ({
    user: {
      username,
      data: modProfileName
        ? {
            ModerationProfile: {
              displayName: modProfileName,
            },
          }
        : null,
    },
  }) as unknown as GraphQLContext;

test("permanentlyDeleteImage lets an uploader delete their own image and storage object", async () => {
  const { driver, calls } = buildDriver({
    target: {
      uploadedByUsername: null,
      uploaderUsername: "alice",
    },
  });
  const deleted: Record<string, unknown>[] = [];
  const resolver = getResolver({
    driver,
    mediaType: "Image",
    deleteObject: async (input) => {
      deleted.push(input);
      return { status: "deleted" };
    },
    checkServerModPermission: async () => new Error("not a mod"),
  });

  const result = await resolver(
    null,
    { imageId: "image-1" },
    contextFor("alice")
  );

  assert.deepEqual(
    {
      permanentlyRemoved: result.permanentlyRemoved,
      deleted,
      writeCount: calls.writes.length,
    },
    {
      permanentlyRemoved: true,
      deleted: [
        {
          storageBucket: "bucket",
          storageObjectName: "uploads/alice/file.stl",
        },
      ],
      writeCount: 1,
    }
  );
});

test("permanentlyDeleteDownloadableFile lets a discussion author delete an older download without upload metadata", async () => {
  const { driver, calls } = buildDriver({
    target: {
      uploadedByUsername: null,
      storageBucket: null,
      storageObjectName: null,
      discussionAuthorUsernames: ["alice"],
    },
  });
  const resolver = getResolver({
    driver,
    mediaType: "DownloadableFile",
    deleteObject: async (input) => ({
      status: input.storageObjectName ? "deleted" : "skipped",
      reason: input.storageObjectName ? undefined : "missing-storage-metadata",
    }),
    checkServerModPermission: async () => new Error("not a mod"),
  });

  const result = await resolver(
    null,
    { downloadableFileId: "file-1" },
    contextFor("alice")
  );

  assert.deepEqual(
    {
      permanentlyRemoved: result.permanentlyRemoved,
      storageDeletion: result.storageDeletion,
      writeCount: calls.writes.length,
    },
    {
      permanentlyRemoved: true,
      storageDeletion: {
        status: "skipped",
        reason: "missing-storage-metadata",
      },
      writeCount: 1,
    }
  );
});

test("permanentlyDeleteImage lets a server mod with permanent removal permission delete another user's upload", async () => {
  const { driver } = buildDriver({
    target: {
      uploadedByUsername: "alice",
    },
  });
  const resolver = getResolver({
    driver,
    mediaType: "Image",
    deleteObject: async () => ({ status: "deleted" }),
    checkServerModPermission: async () => true,
  });

  const result = await resolver(
    null,
    { imageId: "image-1" },
    contextFor("moderator", "Mod One")
  );

  assert.equal(result.permanentlyRemoved, true);
});

test("permanentlyDeleteImage rejects an unrelated non-mod user", async () => {
  const { driver, calls } = buildDriver({
    target: {
      uploadedByUsername: "alice",
    },
  });
  const resolver = getResolver({
    driver,
    mediaType: "Image",
    deleteObject: async () => ({ status: "deleted" }),
    checkServerModPermission: async () => new Error("no permission"),
  });

  await assert.rejects(
    resolver(null, { imageId: "image-1" }, contextFor("mallory")),
    /no permission/
  );
  assert.deepEqual(calls.writes, []);
});

test("permanentlyDeleteImage does not mark the DB removed when storage deletion fails", async () => {
  const { driver, calls } = buildDriver({
    target: {
      uploadedByUsername: "alice",
    },
  });
  const resolver = getResolver({
    driver,
    mediaType: "Image",
    deleteObject: async () => {
      throw new Error("storage unavailable");
    },
    checkServerModPermission: async () => new Error("not a mod"),
  });

  await assert.rejects(
    resolver(null, { imageId: "image-1" }, contextFor("alice")),
    /storage unavailable/
  );
  assert.deepEqual(calls.writes, []);
});
