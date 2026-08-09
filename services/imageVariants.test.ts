import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  buildImageVariantPersistenceFields,
  buildImageVariantStorageObjectName,
  generateImageVariants,
  getGeneratedImageVariantObjectNames,
  type StorageReadClient,
} from "./imageVariants.js";

const buildStorageClient = (sourceBuffer: Buffer) => {
  const calls = {
    bucket: [] as string[],
    download: [] as string[],
    save: [] as Array<{
      storageObjectName: string;
      contentType?: string;
      metadata?: {
        contentType?: string;
        cacheControl?: string;
      };
      size: number;
    }>,
  };

  const storage: StorageReadClient = {
    bucket: (storageBucket: string) => {
      calls.bucket.push(storageBucket);
      return {
        file: (storageObjectName: string) => ({
          download: async () => {
            calls.download.push(storageObjectName);
            return [sourceBuffer];
          },
          save: async (
            data: Buffer,
            options?: {
              contentType?: string;
              metadata?: {
                contentType?: string;
                cacheControl?: string;
              };
            }
          ) => {
            calls.save.push({
              storageObjectName,
              contentType: options?.contentType,
              metadata: options?.metadata,
              size: data.byteLength,
            });
          },
        }),
      };
    },
  };

  return { storage, calls };
};

test("buildImageVariantStorageObjectName appends the semantic variant key", () => {
  assert.equal(
    buildImageVariantStorageObjectName({
      storageObjectName: "uploads/alice/hero.png",
      variantKey: "list160",
    }),
    "uploads/alice/hero__list160.webp"
  );
});

test("getGeneratedImageVariantObjectNames returns all deterministic siblings", () => {
  assert.deepEqual(getGeneratedImageVariantObjectNames("uploads/alice/hero.png"), [
    "uploads/alice/hero__list80.webp",
    "uploads/alice/hero__list160.webp",
    "uploads/alice/hero__list320.webp",
    "uploads/alice/hero__detail640.webp",
    "uploads/alice/hero__detail960.webp",
    "uploads/alice/hero__detail1280.webp",
  ]);
});

test("buildImageVariantPersistenceFields maps semantic keys to direct schema fields", () => {
  assert.deepEqual(
    buildImageVariantPersistenceFields({
      originalWidth: 400,
      originalHeight: 200,
      variantUrls: {
        list80: "https://img.test/list80.webp",
        list160: "https://img.test/list160.webp",
        detail640: "https://img.test/detail640.webp",
      },
      variantStorageObjectNames: {},
    }),
    {
      width: 400,
      height: 200,
      variantUrls: {
        list80: "https://img.test/list80.webp",
        list160: "https://img.test/list160.webp",
        detail640: "https://img.test/detail640.webp",
      },
      list80Url: "https://img.test/list80.webp",
      list160Url: "https://img.test/list160.webp",
      list320Url: undefined,
      detail640Url: "https://img.test/detail640.webp",
      detail960Url: undefined,
      detail1280Url: undefined,
    }
  );
});

test("generateImageVariants creates list-sized webp assets and returns public URLs", async () => {
  const sourceBuffer = await sharp({
    create: {
      width: 400,
      height: 200,
      channels: 3,
      background: { r: 10, g: 20, b: 30 },
    },
  })
    .png()
    .toBuffer();
  const { storage, calls } = buildStorageClient(sourceBuffer);

  const result = await generateImageVariants({
    storageBucket: "media-bucket",
    storageObjectName: "uploads/alice/hero.png",
    storage,
  });

  assert.deepEqual(result.variantUrls, {
    list80:
      "https://storage.googleapis.com/media-bucket/uploads/alice/hero__list80.webp",
    list160:
      "https://storage.googleapis.com/media-bucket/uploads/alice/hero__list160.webp",
    list320:
      "https://storage.googleapis.com/media-bucket/uploads/alice/hero__list320.webp",
    detail640:
      "https://storage.googleapis.com/media-bucket/uploads/alice/hero__detail640.webp",
    detail960:
      "https://storage.googleapis.com/media-bucket/uploads/alice/hero__detail960.webp",
    detail1280:
      "https://storage.googleapis.com/media-bucket/uploads/alice/hero__detail1280.webp",
  });
  assert.deepEqual(result.variantStorageObjectNames, {
    list80: "uploads/alice/hero__list80.webp",
    list160: "uploads/alice/hero__list160.webp",
    list320: "uploads/alice/hero__list320.webp",
    detail640: "uploads/alice/hero__detail640.webp",
    detail960: "uploads/alice/hero__detail960.webp",
    detail1280: "uploads/alice/hero__detail1280.webp",
  });
  assert.equal(result.originalWidth, 400);
  assert.equal(result.originalHeight, 200);
  assert.equal(result.skippedReason, undefined);
  assert.deepEqual(calls.download, ["uploads/alice/hero.png"]);
  assert.deepEqual(
    calls.save.map((call) => call.storageObjectName),
    [
      "uploads/alice/hero__list80.webp",
      "uploads/alice/hero__list160.webp",
      "uploads/alice/hero__list320.webp",
      "uploads/alice/hero__detail640.webp",
      "uploads/alice/hero__detail960.webp",
      "uploads/alice/hero__detail1280.webp",
    ]
  );
  assert.ok(calls.save.every((call) => call.contentType === "image/webp"));
  assert.ok(
    calls.save.every(
      (call) =>
        call.metadata?.cacheControl === "public, max-age=31536000, immutable"
    )
  );
});

test("generateImageVariants skips unsupported SVG uploads without writing variants", async () => {
  const sourceBuffer = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"></svg>'
  );
  const { storage, calls } = buildStorageClient(sourceBuffer);

  const result = await generateImageVariants({
    storageBucket: "media-bucket",
    storageObjectName: "uploads/alice/hero.svg",
    storage,
  });

  assert.deepEqual(result, {
    variantUrls: {},
    variantStorageObjectNames: {},
    skippedReason: "unsupported-format",
  });
  assert.deepEqual(calls.save, []);
});
