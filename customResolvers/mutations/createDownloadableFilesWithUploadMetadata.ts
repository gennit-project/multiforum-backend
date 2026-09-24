import { GraphQLError } from "graphql";
import type { Driver } from "neo4j-driver";
import { logger } from "../../logger.js";
import type {
  DownloadableFile,
  DownloadableFileCreateInput,
} from "../../ogm_types.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import type { GraphQLContext } from "../../types/context.js";
import {
  claimUploadAuditMetadata,
  getUnclaimedUploadAuditMetadata,
  type StorageUploadMetadata,
} from "../../services/uploadStorageMetadata.js";

type Args = {
  input: DownloadableFileCreateInput[];
};

type Input = {
  driver: Driver;
};

type CreatedDownloadableFile = Pick<
  DownloadableFile,
  | "id"
  | "fileName"
  | "kind"
  | "size"
  | "url"
  | "storageBucket"
  | "storageObjectName"
  | "storageUrl"
  | "uploadedAt"
  | "uploadedByUsername"
  | "uploadedByIp"
  | "createdAt"
  | "priceModel"
  | "priceCents"
  | "priceCurrency"
  | "downloadCountTotal"
  | "downloadCountUnique"
  | "attributionOverride"
  | "supportPatreonUrl"
  | "supportBuyMeACoffeeUrl"
  | "supportKoFiUrl"
  | "supportPayPalMeUrl"
  | "scanStatus"
  | "scanCheckedAt"
  | "scanReason"
>;

const createDownloadableFiles = async ({
  driver,
  inputs,
}: {
  driver: Driver;
  inputs: DownloadableFileCreateInput[];
}): Promise<CreatedDownloadableFile[]> => {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  const persistenceInputs = inputs.map((input) => ({
    fileName: input.fileName,
    kind: input.kind,
    size: input.size ?? null,
    url: input.url,
    storageBucket: input.storageBucket ?? null,
    storageObjectName: input.storageObjectName ?? null,
    storageUrl: input.storageUrl ?? null,
    uploadedAt: input.uploadedAt ?? null,
    uploadedByUsername: input.uploadedByUsername ?? null,
    uploadedByIp: input.uploadedByIp ?? null,
    permanentlyRemoved: input.permanentlyRemoved ?? null,
    priceModel: input.priceModel ?? null,
    priceCents: input.priceCents ?? null,
    priceCurrency: input.priceCurrency ?? null,
    downloadCountTotal: input.downloadCountTotal ?? null,
    downloadCountUnique: input.downloadCountUnique ?? null,
    attributionOverride: input.attributionOverride ?? null,
    supportPatreonUrl: input.supportPatreonUrl ?? null,
    supportBuyMeACoffeeUrl: input.supportBuyMeACoffeeUrl ?? null,
    supportKoFiUrl: input.supportKoFiUrl ?? null,
    supportPayPalMeUrl: input.supportPayPalMeUrl ?? null,
    scanStatus: input.scanStatus ?? null,
    scanCheckedAt: input.scanCheckedAt ?? null,
    scanReason: input.scanReason ?? null,
  }));

  try {
    const result = await session.run(
      `
      UNWIND $inputs AS input
      CREATE (file:DownloadableFile {
        id: randomUUID(),
        fileName: input.fileName,
        kind: input.kind,
        size: input.size,
        url: input.url,
        storageBucket: input.storageBucket,
        storageObjectName: input.storageObjectName,
        storageUrl: input.storageUrl,
        uploadedAt: CASE
          WHEN input.uploadedAt IS NULL THEN NULL
          ELSE datetime(input.uploadedAt)
        END,
        uploadedByUsername: input.uploadedByUsername,
        uploadedByIp: input.uploadedByIp,
        createdAt: datetime(),
        permanentlyRemoved: coalesce(input.permanentlyRemoved, false),
        priceModel: coalesce(input.priceModel, "FREE"),
        priceCents: input.priceCents,
        priceCurrency: coalesce(input.priceCurrency, "USD"),
        downloadCountTotal: coalesce(input.downloadCountTotal, 0),
        downloadCountUnique: coalesce(input.downloadCountUnique, 0),
        attributionOverride: input.attributionOverride,
        supportPatreonUrl: input.supportPatreonUrl,
        supportBuyMeACoffeeUrl: input.supportBuyMeACoffeeUrl,
        supportKoFiUrl: input.supportKoFiUrl,
        supportPayPalMeUrl: input.supportPayPalMeUrl,
        scanStatus: coalesce(input.scanStatus, "PENDING"),
        scanCheckedAt: CASE
          WHEN input.scanCheckedAt IS NULL THEN NULL
          ELSE datetime(input.scanCheckedAt)
        END,
        scanReason: input.scanReason
      })
      RETURN file {
        .id,
        .fileName,
        .kind,
        .size,
        .url,
        .storageBucket,
        .storageObjectName,
        .storageUrl,
        .uploadedAt,
        .uploadedByUsername,
        .uploadedByIp,
        .createdAt,
        .priceModel,
        .priceCents,
        .priceCurrency,
        .downloadCountTotal,
        .downloadCountUnique,
        .attributionOverride,
        .supportPatreonUrl,
        .supportBuyMeACoffeeUrl,
        .supportKoFiUrl,
        .supportPayPalMeUrl,
        .scanStatus,
        .scanCheckedAt,
        .scanReason
      } AS file
      `,
      { inputs: persistenceInputs }
    );

    return result.records.map(
      (record) => record.get("file") as CreatedDownloadableFile
    );
  } finally {
    await session.close();
  }
};

const createDownloadableFilesWithUploadMetadata = ({ driver }: Input) => {
  return async (_parent: unknown, args: Args, context: GraphQLContext) => {
    context.user = await setUserDataOnContext({ context });
    const username = context.user?.username;

    if (!username) {
      throw new GraphQLError("You must be logged in to upload files.");
    }

    const uploadMetadataByIndex = await Promise.all(
      (args.input || []).map(async (fileInput) => {
        const storageObjectName = (fileInput as { storageObjectName?: string })?.storageObjectName;
        if (!storageObjectName) {
          return null;
        }

        const uploadMetadata = await getUnclaimedUploadAuditMetadata({
          driver,
          storageObjectName,
          username,
        });

        if (!uploadMetadata) {
          throw new GraphQLError("Upload metadata not found for one or more files.");
        }

        return uploadMetadata;
      })
    );

    const sanitizedInputs = (args.input || []).map((fileInput, index) => {
      const uploadMetadata = uploadMetadataByIndex[index] as StorageUploadMetadata | null;

      return {
        ...fileInput,
        storageBucket: uploadMetadata?.storageBucket,
        storageObjectName: uploadMetadata?.storageObjectName,
        storageUrl: uploadMetadata?.storageUrl,
        uploadedAt: uploadMetadata?.uploadedAt,
        uploadedByUsername: uploadMetadata?.uploadedByUsername,
        uploadedByIp: uploadMetadata?.uploadedByIp,
      };
    });

    try {
      const downloadableFiles = await createDownloadableFiles({
        driver,
        inputs: sanitizedInputs as DownloadableFileCreateInput[],
      });

      await Promise.all(
        downloadableFiles.map((file, index) => {
          const uploadMetadata = uploadMetadataByIndex[index];
          if (!uploadMetadata?.storageObjectName) {
            return Promise.resolve(null);
          }

          return claimUploadAuditMetadata({
            driver,
            storageObjectName: uploadMetadata.storageObjectName,
            username,
            claimedByType: "DownloadableFile",
            claimedById: file.id,
          });
        })
      );

      return { downloadableFiles };
    } catch (error: unknown) {
      logger.error("Error creating downloadable files:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new GraphQLError(`Failed to create downloadable files: ${message}`);
    }
  };
};

export default createDownloadableFilesWithUploadMetadata;
