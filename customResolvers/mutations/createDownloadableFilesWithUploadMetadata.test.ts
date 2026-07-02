import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import type { Driver } from "neo4j-driver";
import createDownloadableFilesWithUploadMetadata from "./createDownloadableFilesWithUploadMetadata.js";
import type { GraphQLContext } from "../../types/context.js";

process.env.PLAYWRIGHT_MOCK_AUTH = "true";

class DownloadableFileModelStub {
  createCalls: any[] = [];

  constructor(private createImpl: (args: any) => any) {}

  async create(args: any) {
    this.createCalls.push(args);
    return this.createImpl(args);
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
                ModerationProfile: {
                  displayName: `mod-${username}`,
                },
              },
            ],
          };
        }
        throw new Error("No model lookup expected");
      },
    },
  }) as unknown as GraphQLContext;

test("createDownloadableFiles copies verified upload metadata into the file", async () => {
  const { driver, calls } = buildDriver({
    storageBucket: "bucket",
    storageObjectName: "uploads/alice/model.stl",
    storageUrl: "https://storage.googleapis.com/bucket/uploads/alice/model.stl",
    uploadedAt: "2026-07-01T12:00:00.000000000Z",
    uploadedByUsername: "alice",
    uploadedByIp: "203.0.113.10",
  });
  const DownloadableFile = new DownloadableFileModelStub((args) => ({
    downloadableFiles: [
      {
        id: "file-1",
        ...args.input[0],
      },
    ],
  }));
  const resolver = createDownloadableFilesWithUploadMetadata({
    DownloadableFile: DownloadableFile as any,
    driver,
  });

  const result = await resolver(
    null,
    {
      input: [
        {
          fileName: "model.stl",
          kind: "STL",
          url: "https://storage.googleapis.com/bucket/uploads/alice/model.stl",
          storageObjectName: "uploads/alice/model.stl",
        } as any,
      ],
    },
    createMockContext("alice")
  );

  assert.deepEqual(
    {
      fileMetadata: DownloadableFile.createCalls[0].input[0],
      claimedByType: calls.run[1].params.claimedByType,
      claimedById: calls.run[1].params.claimedById,
      resultId: result.downloadableFiles[0].id,
    },
    {
      fileMetadata: {
        fileName: "model.stl",
        kind: "STL",
        url: "https://storage.googleapis.com/bucket/uploads/alice/model.stl",
        storageObjectName: "uploads/alice/model.stl",
        storageBucket: "bucket",
        storageUrl: "https://storage.googleapis.com/bucket/uploads/alice/model.stl",
        uploadedAt: "2026-07-01T12:00:00.000000000Z",
        uploadedByUsername: "alice",
        uploadedByIp: "203.0.113.10",
      },
      claimedByType: "DownloadableFile",
      claimedById: "file-1",
      resultId: "file-1",
    }
  );
});

test("createDownloadableFiles rejects an unverified storage object", async () => {
  const { driver } = buildDriver();
  const DownloadableFile = new DownloadableFileModelStub(() => ({
    downloadableFiles: [],
  }));
  const resolver = createDownloadableFilesWithUploadMetadata({
    DownloadableFile: DownloadableFile as any,
    driver,
  });

  await assert.rejects(
    resolver(
      null,
      {
        input: [
          {
            fileName: "model.stl",
            kind: "STL",
            url: "https://storage.googleapis.com/bucket/uploads/alice/model.stl",
            storageObjectName: "uploads/alice/model.stl",
          } as any,
        ],
      },
      createMockContext("alice")
    ),
    /Upload metadata not found/
  );
});
