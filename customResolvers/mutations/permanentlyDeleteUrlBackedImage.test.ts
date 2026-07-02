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

const buildDriver = ({ target }: { target: TargetRecord | null }) => {
  const calls = {
    reads: [] as Record<string, unknown>[],
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

        calls.writes.push({ query, params });
        return {
          records: [
            buildRecord(
              query.includes("target:User")
                ? {
                    username: params.username,
                    profilePicURL: null,
                  }
                : {
                    uniqueName: params.channelUniqueName,
                    channelBannerURL: null,
                  }
            ),
          ],
        };
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
