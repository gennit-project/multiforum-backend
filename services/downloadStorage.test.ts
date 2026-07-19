import assert from "node:assert/strict";
import test from "node:test";
import {
  createDownloadReadUrl,
  DOWNLOAD_READ_URL_TTL_MS,
} from "./downloadStorage.js";

test("signs stored download objects for short-lived read access", async () => {
  let signedOptions: unknown;
  const url = await createDownloadReadUrl({
    file: {
      url: "https://storage.googleapis.com/private-bucket/file.zip",
      storageBucket: "private-bucket",
      storageObjectName: "uploads/alice/file.zip",
    },
    storage: {
      bucket: () => ({
        file: () => ({
          getSignedUrl: async (options: unknown) => {
            signedOptions = options;
            return ["https://signed.example.com/file.zip"];
          },
        }),
      }),
    } as any,
    now: () => 1_000,
  });

  assert.deepEqual({ url, signedOptions }, {
    url: "https://signed.example.com/file.zip",
    signedOptions: {
      version: "v4",
      action: "read",
      expires: 1_000 + DOWNLOAD_READ_URL_TTL_MS,
      responseDisposition: "attachment",
    },
  });
});

test("preserves legacy URL-backed downloads", async () => {
  const url = await createDownloadReadUrl({
    file: { url: "https://legacy.example.com/file.zip" },
  });

  assert.equal(url, "https://legacy.example.com/file.zip");
});
