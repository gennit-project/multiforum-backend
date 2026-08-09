import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import type { Driver } from "neo4j-driver";
import setChannelIcon from "./setChannelIcon.js";
import type { GraphQLContext } from "../../types/context.js";

process.env.PLAYWRIGHT_MOCK_AUTH = "true";

class ChannelModelStub {
  updateCalls: any[] = [];

  constructor(private readonly updateImpl: (args: any) => any) {}

  async update(args: any) {
    this.updateCalls.push(args);
    return this.updateImpl(args);
  }
}

const buildDriver = (recordData?: Record<string, unknown>) => {
  const calls = {
    sessions: [] as string[],
    run: [] as Array<{ query: string; params: Record<string, unknown> }>,
    close: 0,
  };

  const driver = {
    session: ({ defaultAccessMode }: { defaultAccessMode: string }) => {
      calls.sessions.push(defaultAccessMode);
      return {
        run: async (query: string, params: Record<string, unknown>) => {
          calls.run.push({ query, params });
          return {
            records: recordData
              ? [
                  {
                    get: (key: string) => recordData[key],
                  },
                ]
              : [],
          };
        },
        close: async () => {
          calls.close += 1;
        },
      };
    },
  };

  return { driver: driver as unknown as Driver, calls };
};

const createMockContext = (username: string) =>
  ({
    req: {
      headers: {
        authorization: `Bearer ${jwt.sign(
          { email: `${username}@example.com`, username },
          "test-secret"
        )}`,
      },
    },
    ogm: {
      model: (name: string) => {
        if (name === "User") {
          return {
            find: async () => [
              {
                ModerationProfile: null,
              },
            ],
          };
        }

        throw new Error(`Unexpected model lookup: ${name}`);
      },
    },
  }) as unknown as GraphQLContext;

test("setChannelIcon persists icon variants for a verified uploaded channel icon", async () => {
  const { driver, calls } = buildDriver({
    storageBucket: "bucket",
    storageObjectName: "uploads/alice/icon.png",
    storageUrl: "https://storage.googleapis.com/bucket/uploads/alice/icon.png",
    uploadedAt: "2026-08-09T12:00:00.000000000Z",
    uploadedByUsername: "alice",
    uploadedByIp: "203.0.113.10",
  });
  const Channel = new ChannelModelStub((args) => ({
    channels: [
      {
        uniqueName: "cats",
        ...args.update,
      },
    ],
  }));
  const resolver = setChannelIcon({
    Channel: Channel as any,
    driver,
    generateVariants: async () => ({
      variantUrls: {
        avatar32:
          "https://storage.googleapis.com/bucket/uploads/alice/icon__avatar32.webp",
        avatar48:
          "https://storage.googleapis.com/bucket/uploads/alice/icon__avatar48.webp",
        avatar64:
          "https://storage.googleapis.com/bucket/uploads/alice/icon__avatar64.webp",
        avatar96:
          "https://storage.googleapis.com/bucket/uploads/alice/icon__avatar96.webp",
      },
      variantStorageObjectNames: {
        avatar32: "uploads/alice/icon__avatar32.webp",
        avatar48: "uploads/alice/icon__avatar48.webp",
        avatar64: "uploads/alice/icon__avatar64.webp",
        avatar96: "uploads/alice/icon__avatar96.webp",
      },
    }),
  });

  const result = await resolver(
    null,
    {
      channelUniqueName: "cats",
      imageUrl: "https://storage.googleapis.com/bucket/uploads/alice/icon.png",
    },
    createMockContext("alice")
  );

  assert.deepEqual(
    {
      updateInput: Channel.updateCalls[0],
      claimedByType: calls.run[1].params.claimedByType,
      claimedById: calls.run[1].params.claimedById,
      result,
    },
    {
      updateInput: {
        where: { uniqueName: "cats" },
        update: {
          channelIconURL:
            "https://storage.googleapis.com/bucket/uploads/alice/icon.png",
          variantUrls: {
            avatar32:
              "https://storage.googleapis.com/bucket/uploads/alice/icon__avatar32.webp",
            avatar48:
              "https://storage.googleapis.com/bucket/uploads/alice/icon__avatar48.webp",
            avatar64:
              "https://storage.googleapis.com/bucket/uploads/alice/icon__avatar64.webp",
            avatar96:
              "https://storage.googleapis.com/bucket/uploads/alice/icon__avatar96.webp",
          },
          icon32Url:
            "https://storage.googleapis.com/bucket/uploads/alice/icon__avatar32.webp",
          icon48Url:
            "https://storage.googleapis.com/bucket/uploads/alice/icon__avatar48.webp",
          icon64Url:
            "https://storage.googleapis.com/bucket/uploads/alice/icon__avatar64.webp",
          icon96Url:
            "https://storage.googleapis.com/bucket/uploads/alice/icon__avatar96.webp",
        },
        selectionSet: `{ channels 
  {
    uniqueName
    channelIconURL
    variantUrls
    icon32Url
    icon48Url
    icon64Url
    icon96Url
  }
 }`,
      },
      claimedByType: "ChannelIcon",
      claimedById: "cats",
      result: {
        uniqueName: "cats",
        channelIconURL:
          "https://storage.googleapis.com/bucket/uploads/alice/icon.png",
        variantUrls: {
          avatar32:
            "https://storage.googleapis.com/bucket/uploads/alice/icon__avatar32.webp",
          avatar48:
            "https://storage.googleapis.com/bucket/uploads/alice/icon__avatar48.webp",
          avatar64:
            "https://storage.googleapis.com/bucket/uploads/alice/icon__avatar64.webp",
          avatar96:
            "https://storage.googleapis.com/bucket/uploads/alice/icon__avatar96.webp",
        },
        icon32Url:
          "https://storage.googleapis.com/bucket/uploads/alice/icon__avatar32.webp",
        icon48Url:
          "https://storage.googleapis.com/bucket/uploads/alice/icon__avatar48.webp",
        icon64Url:
          "https://storage.googleapis.com/bucket/uploads/alice/icon__avatar64.webp",
        icon96Url:
          "https://storage.googleapis.com/bucket/uploads/alice/icon__avatar96.webp",
      },
    }
  );
});

test("setChannelIcon rejects a channel icon without verified upload metadata", async () => {
  const { driver } = buildDriver();
  const Channel = new ChannelModelStub(() => ({ channels: [] }));
  const resolver = setChannelIcon({
    Channel: Channel as any,
    driver,
  });

  await assert.rejects(
    resolver(
      null,
      {
        channelUniqueName: "cats",
        imageUrl: "https://storage.googleapis.com/bucket/uploads/alice/icon.png",
      },
      createMockContext("alice")
    ),
    /Upload metadata not found/
  );
});
