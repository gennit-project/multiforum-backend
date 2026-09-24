import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import type { Driver } from "neo4j-driver";
import {
  FileKind,
  PriceModel,
  ScanStatus,
  type DownloadableFileCreateInput,
} from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import createDownloadableFilesWithUploadMetadata from "./createDownloadableFilesWithUploadMetadata.js";

process.env.PLAYWRIGHT_MOCK_AUTH = "true";

type QueryCall = {
  query: string;
  params: Record<string, unknown>;
};

type DriverOptions = {
  uploadMetadata?: Record<string, unknown>;
  createError?: Error;
};

const buildDriver = ({
  uploadMetadata,
  createError,
}: DriverOptions = {}) => {
  const calls = {
    sessions: [] as string[],
    run: [] as QueryCall[],
    close: 0,
  };

  const driver = {
    session: ({ defaultAccessMode }: { defaultAccessMode: string }) => {
      calls.sessions.push(defaultAccessMode);
      return {
        run: async (query: string, params: Record<string, unknown>) => {
          calls.run.push({ query, params });

          if (query.includes("CREATE (file:DownloadableFile")) {
            if (createError) throw createError;

            const inputs = params.inputs as Array<Record<string, unknown>>;
            const file = {
              id: "file-1",
              createdAt: "2026-07-01T12:01:00.000Z",
              priceModel: "FREE",
              priceCurrency: "USD",
              downloadCountTotal: 0,
              downloadCountUnique: 0,
              scanStatus: "PENDING",
              ...inputs[0],
            };

            return {
              records: [
                {
                  get: (key: string) => (key === "file" ? file : undefined),
                },
              ],
            };
          }

          if (query.includes("MATCH (audit:UploadedFileAudit")) {
            const isClaim = query.includes("audit.claimedAt =");
            return {
              records:
                uploadMetadata && (!isClaim || uploadMetadata)
                  ? [
                      {
                        get: (key: string) => uploadMetadata[key],
                      },
                    ]
                  : [],
            };
          }

          throw new Error("Unexpected query");
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

const createInput = (
  overrides: Partial<DownloadableFileCreateInput> = {}
): DownloadableFileCreateInput => ({
  fileName: "model.stl",
  kind: FileKind.Stl,
  url: "https://storage.googleapis.com/bucket/uploads/alice/model.stl",
  storageObjectName: "uploads/alice/model.stl",
  ...overrides,
});

test("createDownloadableFiles persists directly with verified upload metadata", async () => {
  const uploadMetadata = {
    storageBucket: "bucket",
    storageObjectName: "uploads/alice/model.stl",
    storageUrl: "https://storage.googleapis.com/bucket/uploads/alice/model.stl",
    uploadedAt: "2026-07-01T12:00:00.000000000Z",
    uploadedByUsername: "alice",
    uploadedByIp: "203.0.113.10",
  };
  const { driver, calls } = buildDriver({ uploadMetadata });
  const resolver = createDownloadableFilesWithUploadMetadata({ driver });

  const result = await resolver(
    null,
    { input: [createInput()] },
    createMockContext("alice")
  );

  const persistedInputs = calls.run[1].params.inputs as Array<
    Record<string, unknown>
  >;
  assert.match(calls.run[1].query, /CREATE \(file:DownloadableFile/);
  assert.deepEqual(
    {
      fileMetadata: persistedInputs[0],
      claimedByType: calls.run[2].params.claimedByType,
      claimedById: calls.run[2].params.claimedById,
      resultId: result.downloadableFiles[0].id,
      sessionsClosed: calls.close,
    },
    {
      fileMetadata: {
        fileName: "model.stl",
        kind: "STL",
        size: null,
        url: "https://storage.googleapis.com/bucket/uploads/alice/model.stl",
        storageBucket: "bucket",
        storageObjectName: "uploads/alice/model.stl",
        storageUrl:
          "https://storage.googleapis.com/bucket/uploads/alice/model.stl",
        uploadedAt: "2026-07-01T12:00:00.000000000Z",
        uploadedByUsername: "alice",
        uploadedByIp: "203.0.113.10",
        permanentlyRemoved: null,
        priceModel: null,
        priceCents: null,
        priceCurrency: null,
        downloadCountTotal: null,
        downloadCountUnique: null,
        attributionOverride: null,
        supportPatreonUrl: null,
        supportBuyMeACoffeeUrl: null,
        supportKoFiUrl: null,
        supportPayPalMeUrl: null,
        scanStatus: null,
        scanCheckedAt: null,
        scanReason: null,
      },
      claimedByType: "DownloadableFile",
      claimedById: "file-1",
      resultId: "file-1",
      sessionsClosed: 3,
    }
  );
});

test("createDownloadableFiles rejects an unverified storage object", async () => {
  const { driver, calls } = buildDriver();
  const resolver = createDownloadableFilesWithUploadMetadata({ driver });

  await assert.rejects(
    resolver(
      null,
      { input: [createInput()] },
      createMockContext("alice")
    ),
    /Upload metadata not found/
  );

  assert.equal(
    calls.run.some(({ query }) =>
      query.includes("CREATE (file:DownloadableFile")
    ),
    false
  );
});

test("createDownloadableFiles persists optional fields for a legacy URL", async () => {
  const { driver, calls } = buildDriver();
  const resolver = createDownloadableFilesWithUploadMetadata({ driver });

  const result = await resolver(
    null,
    {
      input: [
        createInput({
          storageObjectName: null,
          url: "https://example.com/legacy.zip",
          size: 42,
          permanentlyRemoved: false,
          priceModel: PriceModel.Free,
          priceCents: 0,
          priceCurrency: "USD",
          downloadCountTotal: 2,
          downloadCountUnique: 1,
          attributionOverride: "Sample creator",
          supportPatreonUrl: "https://patreon.com/sample",
          supportBuyMeACoffeeUrl: "https://buymeacoffee.com/sample",
          supportKoFiUrl: "https://ko-fi.com/sample",
          supportPayPalMeUrl: "https://paypal.me/sample",
          scanStatus: ScanStatus.Clean,
          scanCheckedAt: "2026-07-01T12:02:00.000Z",
          scanReason: "No threats found",
        }),
      ],
    },
    createMockContext("alice")
  );

  assert.equal(result.downloadableFiles[0].id, "file-1");
  assert.equal(calls.run.length, 1);
  assert.match(calls.run[0].query, /CREATE \(file:DownloadableFile/);
  const inputs = calls.run[0].params.inputs as Array<Record<string, unknown>>;
  assert.deepEqual(
    {
      size: inputs[0].size,
      priceModel: inputs[0].priceModel,
      scanStatus: inputs[0].scanStatus,
      scanCheckedAt: inputs[0].scanCheckedAt,
    },
    {
      size: 42,
      priceModel: "FREE",
      scanStatus: "CLEAN",
      scanCheckedAt: "2026-07-01T12:02:00.000Z",
    }
  );
});

test("createDownloadableFiles wraps persistence failures and closes the session", async () => {
  const { driver, calls } = buildDriver({
    createError: new Error("database unavailable"),
  });
  const resolver = createDownloadableFilesWithUploadMetadata({ driver });

  await assert.rejects(
    resolver(
      null,
      {
        input: [
          createInput({
            storageObjectName: null,
            url: "https://example.com/legacy.zip",
          }),
        ],
      },
      createMockContext("alice")
    ),
    /Failed to create downloadable files: database unavailable/
  );

  assert.equal(calls.close, 1);
});
