import { GraphQLError } from "graphql";
import type { Driver } from "neo4j-driver";
import { logger } from "../../logger.js";
import type {
  DownloadableFileCreateInput,
  DownloadableFileModel,
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
  DownloadableFile: DownloadableFileModel;
  driver: Driver;
};

const selectionSet = `
  {
    downloadableFiles {
      id
      fileName
      kind
      size
      url
      storageBucket
      storageObjectName
      storageUrl
      uploadedAt
      uploadedByUsername
      uploadedByIp
      createdAt
      priceModel
      priceCents
      priceCurrency
      downloadCountTotal
      downloadCountUnique
      attributionOverride
      supportPatreonUrl
      supportBuyMeACoffeeUrl
      supportKoFiUrl
      supportPayPalMeUrl
      scanStatus
      scanCheckedAt
    }
  }
`;

const createDownloadableFilesWithUploadMetadata = ({
  DownloadableFile,
  driver,
}: Input) => {
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
      const response = await DownloadableFile.create({
        input: sanitizedInputs as unknown as DownloadableFileCreateInput[],
        selectionSet,
      });

      await Promise.all(
        response.downloadableFiles.map((file, index) => {
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

      return response;
    } catch (error: unknown) {
      logger.error("Error creating downloadable files:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new GraphQLError(`Failed to create downloadable files: ${message}`);
    }
  };
};

export default createDownloadableFilesWithUploadMetadata;
