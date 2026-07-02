import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import {
  buildStorageObjectName,
  buildStorageUrl,
  claimUploadAuditMetadata,
  createUploadAuditRecord,
  getRequesterIp,
  getUnclaimedUploadAuditMetadata,
} from "./uploadStorageMetadata.js";

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

test("buildStorageObjectName includes a sanitized username segment", () => {
  const objectName = buildStorageObjectName({
    username: "alice/example",
    originalFilename: "My Model.stl",
    now: new Date("2026-07-01T12:00:00.000Z"),
    id: "fixed-id",
  });

  assert.equal(
    objectName,
    "uploads/alice_example/2026-07-01T12-00-00-000Z-fixed-id-My_Model.stl"
  );
});

test("buildStorageUrl encodes bucket and object name safely", () => {
  const storageUrl = buildStorageUrl({
    storageBucket: "my bucket",
    storageObjectName: "uploads/alice/a file.stl",
  });

  assert.equal(
    storageUrl,
    "https://storage.googleapis.com/my%20bucket/uploads/alice/a%20file.stl"
  );
});

test("getRequesterIp prefers the first forwarded IP", () => {
  const ip = getRequesterIp({
    req: {
      headers: {
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
      },
    } as any,
  });

  assert.equal(ip, "203.0.113.10");
});

test("createUploadAuditRecord writes server-owned audit metadata", async () => {
  const { driver, calls } = buildDriver();

  await createUploadAuditRecord({
    driver,
    storageBucket: "bucket",
    storageObjectName: "uploads/alice/file.stl",
    storageUrl: "https://storage.googleapis.com/bucket/uploads/alice/file.stl",
    originalFilename: "file.stl",
    contentType: "model/stl",
    uploadedAt: "2026-07-01T12:00:00.000Z",
    uploadedByUsername: "alice",
    uploadedByIp: "203.0.113.10",
  });

  assert.deepEqual(calls.run[0].params, {
    storageBucket: "bucket",
    storageObjectName: "uploads/alice/file.stl",
    storageUrl: "https://storage.googleapis.com/bucket/uploads/alice/file.stl",
    originalFilename: "file.stl",
    contentType: "model/stl",
    uploadedAt: "2026-07-01T12:00:00.000Z",
    uploadedByUsername: "alice",
    uploadedByIp: "203.0.113.10",
  });
});

test("getUnclaimedUploadAuditMetadata returns matching metadata", async () => {
  const { driver } = buildDriver({
    storageBucket: "bucket",
    storageObjectName: "uploads/alice/file.stl",
    storageUrl: "https://storage.googleapis.com/bucket/uploads/alice/file.stl",
    uploadedAt: "2026-07-01T12:00:00.000000000Z",
    uploadedByUsername: "alice",
    uploadedByIp: "203.0.113.10",
  });

  const metadata = await getUnclaimedUploadAuditMetadata({
    driver,
    storageObjectName: "uploads/alice/file.stl",
    username: "alice",
  });

  assert.deepEqual(metadata, {
    storageBucket: "bucket",
    storageObjectName: "uploads/alice/file.stl",
    storageUrl: "https://storage.googleapis.com/bucket/uploads/alice/file.stl",
    uploadedAt: "2026-07-01T12:00:00.000000000Z",
    uploadedByUsername: "alice",
    uploadedByIp: "203.0.113.10",
  });
});

test("claimUploadAuditMetadata records the claiming entity", async () => {
  const { driver, calls } = buildDriver({
    storageBucket: "bucket",
    storageObjectName: "uploads/alice/file.stl",
    storageUrl: "https://storage.googleapis.com/bucket/uploads/alice/file.stl",
    uploadedAt: "2026-07-01T12:00:00.000000000Z",
    uploadedByUsername: "alice",
    uploadedByIp: null,
  });

  await claimUploadAuditMetadata({
    driver,
    storageObjectName: "uploads/alice/file.stl",
    username: "alice",
    claimedByType: "DownloadableFile",
    claimedById: "file-1",
  });

  assert.deepEqual(
    {
      storageObjectName: calls.run[0].params.storageObjectName,
      username: calls.run[0].params.username,
      claimedByType: calls.run[0].params.claimedByType,
      claimedById: calls.run[0].params.claimedById,
    },
    {
      storageObjectName: "uploads/alice/file.stl",
      username: "alice",
      claimedByType: "DownloadableFile",
      claimedById: "file-1",
    }
  );
});
