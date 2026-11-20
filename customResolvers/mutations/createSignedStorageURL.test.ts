import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FILE_MAX_UPLOAD_BYTES,
  DEFAULT_IMAGE_MAX_UPLOAD_BYTES,
  resolveMaxUploadBytes,
  resolveUploadBucketName,
  validateFile,
} from "./createSignedStorageURL.js";

const nullableBytes = (value: unknown): number | null =>
  typeof value === "number" ? value : null;

const createContext = ({
  channel,
  channels,
  serverConfig = { allowedFileTypes: [] },
}: {
  channel?: Record<string, unknown> | null;
  channels?: Record<string, Record<string, unknown> | null>;
  serverConfig?: Record<string, unknown>;
}) => ({
  driver: {},
  contentFeaturePolicyRepository: {
    findChannelPolicy: async (uniqueName: string) => {
      const found = channels
        ? channels[uniqueName] ?? null
        : channel ?? null;
      return {
        found: found !== null,
        uniqueName: found ? uniqueName : null,
        eventsEnabled: null,
        feedbackEnabled: null,
        downloadsEnabled: null,
        imageUploadsEnabled:
          typeof found?.imageUploadsEnabled === "boolean"
            ? found.imageUploadsEnabled
            : null,
        wikiEnabled: null,
        allowedFileTypes: Array.isArray(found?.allowedFileTypes)
          ? found.allowedFileTypes as string[]
          : [],
        imageMaxUploadBytes: nullableBytes(found?.imageMaxUploadBytes),
        fileMaxUploadBytes: nullableBytes(found?.fileMaxUploadBytes),
      };
    },
    findServerFileTypePolicy: async () => ({
      found: true,
      allowedFileTypes: Array.isArray(serverConfig.allowedFileTypes)
        ? serverConfig.allowedFileTypes as string[]
        : [],
      imageMaxUploadBytes: nullableBytes(serverConfig.imageMaxUploadBytes),
      fileMaxUploadBytes: nullableBytes(serverConfig.fileMaxUploadBytes),
    }),
  },
}) as unknown as Parameters<typeof validateFile>[3];

test("image upload validation rejects disabled image upload channels", async () => {
  await assert.rejects(
    validateFile(
      "photo.jpg",
      "image/jpeg",
      ["cats"],
      createContext({
        channel: { uniqueName: "cats", imageUploadsEnabled: false },
      })
    ),
    /Image uploads are disabled in channel 'cats'/
  );
});

test("image upload validation ignores download file type restrictions", async () => {
  const result = await validateFile(
    "photo.jpg",
    "image/jpeg",
    ["cats"],
    createContext({
      channel: {
        uniqueName: "cats",
        imageUploadsEnabled: true,
        allowedFileTypes: ["stl"],
      },
    })
  );

  assert.equal(result, undefined);
});

test("download upload validation rejects disallowed channel file types", async () => {
  await assert.rejects(
    validateFile(
      "archive.zip",
      "application/zip",
      ["cats"],
      createContext({
        channel: {
          uniqueName: "cats",
          imageUploadsEnabled: true,
          allowedFileTypes: ["stl"],
        },
      })
    ),
    /File type 'zip' is not allowed in channel 'cats'/
  );
});

test("routes downloadable files to the private bucket", () => {
  const bucketName = resolveUploadBucketName({
    uploadTarget: "PRIVATE_DOWNLOAD",
    env: {
      GCS_BUCKET_NAME: "public-media",
      GCS_PRIVATE_DOWNLOAD_BUCKET_NAME: "private-downloads",
    },
  });

  assert.equal(bucketName, "private-downloads");
});

test("fails closed when the private download bucket is not configured", () => {
  assert.throws(
    () => resolveUploadBucketName({
      uploadTarget: "PRIVATE_DOWNLOAD",
      env: { GCS_BUCKET_NAME: "public-media" },
    }),
    /GCS_PRIVATE_DOWNLOAD_BUCKET_NAME environment variable not set/
  );
});

test("keeps existing upload callers on the public media bucket", () => {
  const bucketName = resolveUploadBucketName({
    env: { GCS_BUCKET_NAME: "public-media" },
  });

  assert.equal(bucketName, "public-media");
});

test("falls back to the hard default image ceiling when nothing is configured", async () => {
  const limit = await resolveMaxUploadBytes(
    "image/png",
    [],
    createContext({ serverConfig: { allowedFileTypes: [] } })
  );

  assert.equal(limit, DEFAULT_IMAGE_MAX_UPLOAD_BYTES);
});

test("falls back to the hard default file ceiling for non-image uploads", async () => {
  const limit = await resolveMaxUploadBytes(
    "application/zip",
    [],
    createContext({ serverConfig: { allowedFileTypes: [] } })
  );

  assert.equal(limit, DEFAULT_FILE_MAX_UPLOAD_BYTES);
});

test("uses the ServerConfig image ceiling when no channel overrides it", async () => {
  const limit = await resolveMaxUploadBytes(
    "image/jpeg",
    ["cats"],
    createContext({
      channel: { uniqueName: "cats", imageUploadsEnabled: true },
      serverConfig: { imageMaxUploadBytes: 2_000_000 },
    })
  );

  assert.equal(limit, 2_000_000);
});

test("a channel override takes precedence over the server image ceiling", async () => {
  const limit = await resolveMaxUploadBytes(
    "image/jpeg",
    ["cats"],
    createContext({
      channel: {
        uniqueName: "cats",
        imageUploadsEnabled: true,
        imageMaxUploadBytes: 500_000,
      },
      serverConfig: { imageMaxUploadBytes: 2_000_000 },
    })
  );

  assert.equal(limit, 500_000);
});

test("the most restrictive limit wins across multiple channels", async () => {
  const limit = await resolveMaxUploadBytes(
    "image/jpeg",
    ["cats", "dogs"],
    createContext({
      channels: {
        cats: { uniqueName: "cats", imageMaxUploadBytes: 800_000 },
        dogs: { uniqueName: "dogs", imageMaxUploadBytes: 300_000 },
      },
      serverConfig: { imageMaxUploadBytes: 2_000_000 },
    })
  );

  assert.equal(limit, 300_000);
});

test("ignores non-positive configured limits and falls back to the server default", async () => {
  const limit = await resolveMaxUploadBytes(
    "image/jpeg",
    ["cats"],
    createContext({
      channel: {
        uniqueName: "cats",
        imageUploadsEnabled: true,
        imageMaxUploadBytes: 0,
      },
      serverConfig: { imageMaxUploadBytes: 2_000_000 },
    })
  );

  assert.equal(limit, 2_000_000);
});
