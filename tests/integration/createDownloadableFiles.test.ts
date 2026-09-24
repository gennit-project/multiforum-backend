import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { FileKind } from "../../ogm_types.js";
import {
  mockToken,
  modContext,
  resetDb,
  run,
  startImageModEnv,
  stopImageModEnv,
  type ImageModEnv,
} from "./imageModerationHarness.js";

let env: ImageModEnv;

before(
  async () => {
    env = await startImageModEnv();
  },
  { timeout: 240000 }
);

after(async () => {
  await stopImageModEnv();
});

beforeEach(async () => {
  await resetDb();
  await run(
    `
    CREATE (:User {username: "alice"})
    CREATE (:UploadedFileAudit {
      id: randomUUID(),
      storageBucket: "downloads",
      storageObjectName: "uploads/alice/model.stl",
      storageUrl: "https://storage.googleapis.com/downloads/uploads/alice/model.stl",
      originalFilename: "model.stl",
      contentType: "model/stl",
      uploadedAt: datetime("2026-07-01T12:00:00.000Z"),
      uploadedByUsername: "alice",
      uploadedByIp: "203.0.113.10"
    })
    `
  );
});

test("authenticated upload creates a downloadable file and claims its audit record", async () => {
  const result = await env.resolvers.Mutation.createDownloadableFiles(
    null,
    {
      input: [
        {
          fileName: "model.stl",
          kind: FileKind.Stl,
          size: 42,
          url: "https://storage.googleapis.com/downloads/uploads/alice/model.stl",
          storageObjectName: "uploads/alice/model.stl",
        },
      ],
    },
    modContext(
      env,
      mockToken({ username: "alice", email: "alice@example.com" })
    )
  );

  assert.equal(result.downloadableFiles.length, 1);
  assert.equal(result.downloadableFiles[0].fileName, "model.stl");
  assert.equal(result.downloadableFiles[0].scanStatus, "PENDING");

  const rows = await run(
    `
    MATCH (file:DownloadableFile {id: $fileId})
    MATCH (audit:UploadedFileAudit {
      storageObjectName: "uploads/alice/model.stl"
    })
    RETURN
      file.storageBucket AS storageBucket,
      file.uploadedByUsername AS uploadedByUsername,
      file.permanentlyRemoved AS permanentlyRemoved,
      audit.claimedByType AS claimedByType,
      audit.claimedById AS claimedById
    `,
    { fileId: result.downloadableFiles[0].id }
  );

  assert.deepEqual(rows, [
    {
      storageBucket: "downloads",
      uploadedByUsername: "alice",
      permanentlyRemoved: false,
      claimedByType: "DownloadableFile",
      claimedById: result.downloadableFiles[0].id,
    },
  ]);
});
