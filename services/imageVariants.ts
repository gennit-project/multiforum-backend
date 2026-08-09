import { Storage } from "@google-cloud/storage";
import sharp from "sharp";
import { buildStorageUrl } from "./uploadStorageMetadata.js";

export const IMAGE_VARIANT_WIDTHS = {
  avatar32: 32,
  avatar48: 48,
  avatar64: 64,
  avatar96: 96,
  list80: 80,
  list160: 160,
  list320: 320,
  detail640: 640,
  detail960: 960,
  detail1280: 1280,
} as const;

export type ImageVariantKey = keyof typeof IMAGE_VARIANT_WIDTHS;

export const USER_AVATAR_VARIANT_KEYS = [
  "avatar32",
  "avatar48",
  "avatar64",
  "avatar96",
] as const satisfies readonly ImageVariantKey[];

export const IMAGE_CONTENT_VARIANT_KEYS = [
  "list80",
  "list160",
  "list320",
  "detail640",
  "detail960",
  "detail1280",
] as const satisfies readonly ImageVariantKey[];

export type ImageVariantGenerationResult = {
  originalWidth?: number;
  originalHeight?: number;
  variantUrls: Partial<Record<ImageVariantKey, string>>;
  variantStorageObjectNames: Partial<Record<ImageVariantKey, string>>;
  skippedReason?: "animated-image" | "missing-dimensions" | "unsupported-format";
};

export type StorageReadFileClient = {
  download: () => Promise<[Buffer]>;
  save: (
    data: Buffer,
    options?: {
      resumable?: boolean;
      contentType?: string;
      metadata?: {
        contentType?: string;
        cacheControl?: string;
      };
    }
  ) => Promise<unknown>;
};

export type StorageReadBucketClient = {
  file: (storageObjectName: string) => StorageReadFileClient;
};

export type StorageReadClient = {
  bucket: (storageBucket: string) => StorageReadBucketClient;
};

const SUPPORTED_SOURCE_FORMATS = new Set([
  "jpeg",
  "jpg",
  "png",
  "webp",
  "gif",
  "avif",
  "heif",
  "tiff",
]);

const VARIANT_CACHE_CONTROL = "public, max-age=31536000, immutable";
const VARIANT_CONTENT_TYPE = "image/webp";

export const buildImageVariantStorageObjectName = ({
  storageObjectName,
  variantKey,
}: {
  storageObjectName: string;
  variantKey: ImageVariantKey;
}): string => {
  const lastSlashIndex = storageObjectName.lastIndexOf("/");
  const directory =
    lastSlashIndex >= 0 ? storageObjectName.slice(0, lastSlashIndex + 1) : "";
  const filename =
    lastSlashIndex >= 0
      ? storageObjectName.slice(lastSlashIndex + 1)
      : storageObjectName;
  const lastDotIndex = filename.lastIndexOf(".");
  const basename =
    lastDotIndex > 0 ? filename.slice(0, lastDotIndex) : filename;

  return `${directory}${basename}__${variantKey}.webp`;
};

export const getGeneratedImageVariantObjectNames = (
  storageObjectName: string,
  variantKeys: readonly ImageVariantKey[] = IMAGE_CONTENT_VARIANT_KEYS
): string[] =>
  variantKeys.map((variantKey) =>
    buildImageVariantStorageObjectName({ storageObjectName, variantKey })
  );

export const buildImageVariantPersistenceFields = ({
  originalWidth,
  originalHeight,
  variantUrls,
}: ImageVariantGenerationResult): {
  width?: number;
  height?: number;
  variantUrls?: Partial<Record<ImageVariantKey, string>>;
  list80Url?: string;
  list160Url?: string;
  list320Url?: string;
  detail640Url?: string;
  detail960Url?: string;
  detail1280Url?: string;
} => ({
  width: originalWidth,
  height: originalHeight,
  variantUrls:
    Object.keys(variantUrls).length > 0 ? { ...variantUrls } : undefined,
  list80Url: variantUrls.list80,
  list160Url: variantUrls.list160,
  list320Url: variantUrls.list320,
  detail640Url: variantUrls.detail640,
  detail960Url: variantUrls.detail960,
  detail1280Url: variantUrls.detail1280,
});

export const buildUserAvatarVariantPersistenceFields = ({
  variantUrls,
}: ImageVariantGenerationResult): {
  variantUrls?: Partial<Record<ImageVariantKey, string>>;
  avatar32Url?: string;
  avatar48Url?: string;
  avatar64Url?: string;
  avatar96Url?: string;
} => ({
  variantUrls:
    Object.keys(variantUrls).length > 0 ? { ...variantUrls } : undefined,
  avatar32Url: variantUrls.avatar32,
  avatar48Url: variantUrls.avatar48,
  avatar64Url: variantUrls.avatar64,
  avatar96Url: variantUrls.avatar96,
});

export const generateImageVariants = async ({
  storageBucket,
  storageObjectName,
  variantKeys = IMAGE_CONTENT_VARIANT_KEYS,
  storage,
}: {
  storageBucket: string;
  storageObjectName: string;
  variantKeys?: readonly ImageVariantKey[];
  storage?: StorageReadClient;
}): Promise<ImageVariantGenerationResult> => {
  const storageClient = storage || new Storage();
  const sourceFile = storageClient.bucket(storageBucket).file(storageObjectName);
  const [sourceBuffer] = await sourceFile.download();

  const metadata = await sharp(sourceBuffer, { animated: true }).metadata();

  if (!metadata.width || !metadata.height) {
    return {
      variantUrls: {},
      variantStorageObjectNames: {},
      skippedReason: "missing-dimensions",
    };
  }

  if ((metadata.pages || 1) > 1) {
    return {
      variantUrls: {},
      variantStorageObjectNames: {},
      skippedReason: "animated-image",
    };
  }

  if (!metadata.format || !SUPPORTED_SOURCE_FORMATS.has(metadata.format)) {
    return {
      variantUrls: {},
      variantStorageObjectNames: {},
      skippedReason: "unsupported-format",
    };
  }

  const variantUrls: Partial<Record<ImageVariantKey, string>> = {};
  const variantStorageObjectNames: Partial<Record<ImageVariantKey, string>> = {};

  for (const variantKey of variantKeys) {
    const targetWidth = IMAGE_VARIANT_WIDTHS[variantKey];
    const variantStorageObjectName = buildImageVariantStorageObjectName({
      storageObjectName,
      variantKey,
    });

    const { data } = await sharp(sourceBuffer)
      .rotate()
      .resize({
        width: targetWidth,
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    await storageClient.bucket(storageBucket).file(variantStorageObjectName).save(
      data,
      {
        resumable: false,
        contentType: VARIANT_CONTENT_TYPE,
        metadata: {
          contentType: VARIANT_CONTENT_TYPE,
          cacheControl: VARIANT_CACHE_CONTROL,
        },
      }
    );

    variantStorageObjectNames[variantKey] = variantStorageObjectName;
    variantUrls[variantKey] = buildStorageUrl({
      storageBucket,
      storageObjectName: variantStorageObjectName,
    });
  }

  return {
    originalWidth: metadata.width,
    originalHeight: metadata.height,
    variantUrls,
    variantStorageObjectNames,
  };
};
