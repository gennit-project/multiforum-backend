import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveUploadBucketName,
  validateFile,
} from "./createSignedStorageURL.js";

const createContext = ({
  channel,
  serverConfig = { allowedFileTypes: [] },
}: {
  channel: Record<string, unknown> | null;
  serverConfig?: Record<string, unknown>;
}) => ({
  driver: {},
  contentFeaturePolicyRepository: {
    findChannelPolicy: async (uniqueName: string) => ({
      found: channel !== null,
      uniqueName: channel ? uniqueName : null,
      eventsEnabled: null,
      feedbackEnabled: null,
      downloadsEnabled: null,
      imageUploadsEnabled:
        typeof channel?.imageUploadsEnabled === "boolean"
          ? channel.imageUploadsEnabled
          : null,
      wikiEnabled: null,
      allowedFileTypes: Array.isArray(channel?.allowedFileTypes)
        ? channel.allowedFileTypes as string[]
        : [],
    }),
    findServerFileTypePolicy: async () => ({
      found: true,
      allowedFileTypes: Array.isArray(serverConfig.allowedFileTypes)
        ? serverConfig.allowedFileTypes as string[]
        : [],
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
