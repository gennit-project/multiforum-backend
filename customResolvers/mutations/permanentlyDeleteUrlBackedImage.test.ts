import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import getResolver from "./permanentlyDeleteUrlBackedImage.js";

type TargetRecord = {
  ownerUsername?: string | null;
  channelUniqueName?: string | null;
  channelOwnerUsernames?: string[];
  currentUrl?: string | null;
  storageBucket?: string | null;
  storageObjectName?: string | null;
};

const buildRecord = (values: Record<string, unknown>) => ({
  keys: Object.keys(values),
  get: (key: string) => values[key],
});

const buildDriver = ({
  target,
  callbackAttempts = 1,
}: {
  target: TargetRecord | null;
  callbackAttempts?: number;
}) => {
  const calls = {
    reads: [] as Record<string, unknown>[],
    executeWrite: 0,
    writes: [] as Record<string, unknown>[],
  };

  const driver = {
    session: ({ defaultAccessMode }: { defaultAccessMode: string }) => ({
      run: async (query: string, params: Record<string, unknown>) => {
        if (defaultAccessMode === "READ") {
          calls.reads.push({ query, params });
          return {
            records: target
              ? [
                  buildRecord({
                    ownerUsername: target.ownerUsername ?? null,
                    channelUniqueName: target.channelUniqueName ?? null,
                    channelOwnerUsernames: target.channelOwnerUsernames || [],
                    currentUrl:
                      target.currentUrl === undefined
                        ? "https://storage.example/image.png"
                        : target.currentUrl,
                    storageBucket:
                      target.storageBucket === undefined
                        ? "bucket"
                        : target.storageBucket,
                    storageObjectName:
                      target.storageObjectName === undefined
                        ? "uploads/alice/image.png"
                        : target.storageObjectName,
                  }),
                ]
              : [],
          };
        }

        throw new Error("Writes must use executeWrite");
      },
      executeWrite: async (
        work: (transaction: {
          run: (query: string, params: Record<string, unknown>) => Promise<{
            records: ReturnType<typeof buildRecord>[];
          }>;
        }) => Promise<Record<string, unknown>>
      ) => {
        calls.executeWrite += 1;
        let result: Record<string, unknown> = {};
        for (let attempt = 0; attempt < callbackAttempts; attempt += 1) {
          result = await work({
            run: async (query, params) => {
              calls.writes.push({ query, params });
              return {
                records: [
                  buildRecord(
                    query.includes("target:User")
                      ? {
                          username: params.username,
                          profilePicURL: null,
                        }
                      : query.includes("channelIconURL")
                        ? {
                            uniqueName: params.channelUniqueName,
                            channelIconURL: null,
                          }
                        : {
                            uniqueName: params.channelUniqueName,
                            channelBannerURL: null,
                          }
                  ),
                ],
              };
            },
          });
        }
        return result;
      },
      close: async () => undefined,
    }),
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

test("permanentlyDeleteProfileImage lets the profile owner delete the active stored image", async () => {
  const { driver, calls } = buildDriver({
    target: {
      ownerUsername: "alice",
    },
  });
  const deleted: Record<string, unknown>[] = [];
  const resolver = getResolver({
    driver,
    referenceType: "ProfileImage",
      deleteObject: async (input) => {
        deleted.push(input);
        return { status: "deleted" };
      },
    checkServerModPermission: async () => {
      throw new Error("permission should not be checked for owner");
    },
  });

  const result = await resolver(
    null,
    { username: "alice", imageUrl: "https://storage.example/image.png" },
    contextFor("alice")
  );

  assert.deepEqual(
    {
      result,
      deleted,
      writeCount: calls.writes.length,
      writeParams: calls.writes[0]?.params,
    },
    {
      result: {
        username: "alice",
        profilePicURL: null,
      },
      deleted: [
        {
          additionalStorageObjectNames: [
            "uploads/alice/image__avatar32.webp",
            "uploads/alice/image__avatar48.webp",
            "uploads/alice/image__avatar64.webp",
            "uploads/alice/image__avatar96.webp",
          ],
          storageBucket: "bucket",
          storageObjectName: "uploads/alice/image.png",
        },
      ],
      writeCount: 1,
      writeParams: {
        username: "alice",
        channelUniqueName: undefined,
        imageUrl: "https://storage.example/image.png",
        removedAt: (calls.writes[0]?.params as Record<string, unknown>).removedAt,
        removedByUsername: "alice",
        removedByModName: null,
      },
    }
  );
});

test("permanentlyDeleteChannelBanner lets a channel owner delete the active banner", async () => {
  const { driver, calls } = buildDriver({
    target: {
      channelUniqueName: "cats",
      channelOwnerUsernames: ["alice"],
    },
  });
  const resolver = getResolver({
    driver,
    referenceType: "ChannelBanner",
    deleteObject: async () => ({ status: "deleted" }),
    checkServerModPermission: async () => {
      throw new Error("permission should not be checked for owner");
    },
  });

  const result = await resolver(
    null,
    {
      channelUniqueName: "cats",
      imageUrl: "https://storage.example/image.png",
    },
    contextFor("alice")
  );

  assert.deepEqual(
    {
      result,
      writeCount: calls.writes.length,
    },
    {
      result: {
        uniqueName: "cats",
        channelBannerURL: null,
      },
      writeCount: 1,
    }
  );
});

test("permanentlyDeleteChannelIcon deletes generated icon variants with the original upload", async () => {
  const { driver, calls } = buildDriver({
    target: {
      channelUniqueName: "cats",
      channelOwnerUsernames: ["alice"],
      storageObjectName: "uploads/alice/icon.png",
    },
  });
  const deleted: Record<string, unknown>[] = [];
  const resolver = getResolver({
    driver,
    referenceType: "ChannelIcon",
    deleteObject: async (input) => {
      deleted.push(input);
      return { status: "deleted" };
    },
    checkServerModPermission: async () => {
      throw new Error("permission should not be checked for owner");
    },
  });

  const result = await resolver(
    null,
    {
      channelUniqueName: "cats",
      imageUrl: "https://storage.example/image.png",
    },
    contextFor("alice")
  );

  assert.deepEqual(
    {
      result,
      deleted,
      writeCount: calls.writes.length,
    },
    {
      result: {
        uniqueName: "cats",
        channelIconURL: null,
      },
      deleted: [
        {
          additionalStorageObjectNames: [
            "uploads/alice/icon__avatar32.webp",
            "uploads/alice/icon__avatar48.webp",
            "uploads/alice/icon__avatar64.webp",
            "uploads/alice/icon__avatar96.webp",
          ],
          storageBucket: "bucket",
          storageObjectName: "uploads/alice/icon.png",
        },
      ],
      writeCount: 1,
    }
  );
});

test("permanentlyDeleteChannelIcon keeps storage deletion outside a retried managed callback", async () => {
  const { driver, calls } = buildDriver({
    target: {
      channelUniqueName: "cats",
      channelOwnerUsernames: ["alice"],
    },
    callbackAttempts: 2,
  });
  let deleteCalls = 0;
  const resolver = getResolver({
    driver,
    referenceType: "ChannelIcon",
    deleteObject: async () => {
      deleteCalls += 1;
      return { status: "deleted" };
    },
    checkServerModPermission: async () => new Error("not a mod"),
  });

  const result = await resolver(
    null,
    {
      channelUniqueName: "cats",
      imageUrl: "https://storage.example/image.png",
    },
    contextFor("alice")
  );

  assert.deepEqual(result, {
    uniqueName: "cats",
    channelIconURL: null,
  });
  assert.equal(calls.executeWrite, 1);
  assert.equal(calls.writes.length, 2);
  assert.equal(deleteCalls, 1);
});

test("permanentlyDeleteChannelBanner lets a server mod delete another channel's active banner", async () => {
  const { driver, calls } = buildDriver({
    target: {
      channelUniqueName: "cats",
      channelOwnerUsernames: ["alice"],
    },
  });
  const resolver = getResolver({
    driver,
    referenceType: "ChannelBanner",
    deleteObject: async () => ({ status: "deleted" }),
    checkServerModPermission: async (permission) => {
      assert.equal(permission, "canPermanentlyRemoveImage");
      return true;
    },
  });

  const result = await resolver(
    null,
    {
      channelUniqueName: "cats",
      imageUrl: "https://storage.example/image.png",
    },
    contextFor("moderator", "Mod One")
  );

  assert.deepEqual(
    {
      result,
      writeParams: calls.writes[0]?.params,
    },
    {
      result: {
        uniqueName: "cats",
        channelBannerURL: null,
      },
      writeParams: {
        username: undefined,
        channelUniqueName: "cats",
        imageUrl: "https://storage.example/image.png",
        removedAt: (calls.writes[0]?.params as Record<string, unknown>).removedAt,
        removedByUsername: "moderator",
        removedByModName: "Mod One",
      },
    }
  );
});

test("permanentlyDeleteProfileImage rejects an unrelated non-mod user", async () => {
  const { driver, calls } = buildDriver({
    target: {
      ownerUsername: "alice",
    },
  });
  const resolver = getResolver({
    driver,
    referenceType: "ProfileImage",
    deleteObject: async () => ({ status: "deleted" }),
    checkServerModPermission: async () => new Error("no permission"),
  });

  await assert.rejects(
    resolver(
      null,
      { username: "alice", imageUrl: "https://storage.example/image.png" },
      contextFor("mallory")
    ),
    /no permission/
  );
  assert.deepEqual(calls.writes, []);
});

test("permanentlyDeleteProfileImage rejects active images without storage metadata", async () => {
  const { driver, calls } = buildDriver({
    target: {
      ownerUsername: "alice",
      storageBucket: null,
      storageObjectName: null,
    },
  });
  const resolver = getResolver({
    driver,
    referenceType: "ProfileImage",
    deleteObject: async () => ({ status: "deleted" }),
    checkServerModPermission: async () => new Error("not a mod"),
  });

  await assert.rejects(
    resolver(
      null,
      { username: "alice", imageUrl: "https://legacy.example/image.png" },
      contextFor("alice")
    ),
    /Storage metadata not found/
  );
  assert.deepEqual(calls.writes, []);
});

test("permanentlyDeleteChannelBanner does not clear the banner when storage deletion fails", async () => {
  const { driver, calls } = buildDriver({
    target: {
      channelUniqueName: "cats",
      channelOwnerUsernames: ["alice"],
    },
  });
  const resolver = getResolver({
    driver,
    referenceType: "ChannelBanner",
    deleteObject: async () => {
      throw new Error("storage unavailable");
    },
    checkServerModPermission: async () => new Error("not a mod"),
  });

  await assert.rejects(
    resolver(
      null,
      {
        channelUniqueName: "cats",
        imageUrl: "https://storage.example/image.png",
      },
      contextFor("alice")
    ),
    /storage unavailable/
  );
  assert.deepEqual(calls.writes, []);
});
