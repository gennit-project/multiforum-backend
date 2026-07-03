import { GraphQLError, type GraphQLResolveInfo } from "graphql";
import type { Driver } from "neo4j-driver";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import type { GraphQLContext } from "../../types/context.js";
import type { ImageCreateInput, ImageModel, UserModel } from "../../ogm_types.js";
import { logger } from "../../logger.js";
import {
  claimUploadAuditMetadata,
  getUnclaimedUploadAuditMetadata,
  type StorageUploadMetadata,
} from "../../services/uploadStorageMetadata.js";

type Args = {
  input: ImageCreateInput[];
};

type Input = {
  Image: ImageModel;
  User: UserModel;
  driver?: Driver;
};

const selectionSet = `
  {
    id
    url
    storageBucket
    storageObjectName
    storageUrl
    uploadedAt
    uploadedByUsername
    uploadedByIp
    alt
    caption
    longDescription
    copyright
    createdAt
    hasSensitiveContent
    hasSpoiler
    scanStatus
    Uploader {
      username
    }
    Albums {
      id
    }
  }
`;

const getResolver = (input: Input) => {
  const { Image, User, driver } = input;

  return async (parent: unknown, args: Args, context: GraphQLContext, info: GraphQLResolveInfo) => {
    const { input: imageInputs } = args;

    context.user = await setUserDataOnContext({
      context,
    });

    const username = context.user?.username;

    if (!username) {
      throw new GraphQLError("You must be logged in to upload images.");
    }

    const users = await User.find({
      where: { username },
      selectionSet: `{ username }`,
    });

    if (users.length === 0) {
      throw new GraphQLError("Could not find the original uploader of this image.");
    }

    const uploadMetadataByIndex = await Promise.all(
      (imageInputs || []).map(async (imageInput) => {
        const storageObjectName = (imageInput as { storageObjectName?: string })?.storageObjectName;
        if (!storageObjectName) {
          return null;
        }

        const uploadMetadata = await getUnclaimedUploadAuditMetadata({
          driver: driver || (() => {
            throw new GraphQLError("Upload metadata lookup is not configured.");
          })(),
          storageObjectName,
          username,
        });

        if (!uploadMetadata) {
          throw new GraphQLError("Upload metadata not found for one or more images.");
        }

        return uploadMetadata;
      })
    );

    const sanitizedInputs = (imageInputs || []).map((imageInput, index) => {
      const { Uploader, ...rest } = imageInput || ({} as ImageCreateInput);
      const uploadMetadata = uploadMetadataByIndex[index] as StorageUploadMetadata | null;
      return {
        ...rest,
        storageBucket: uploadMetadata?.storageBucket,
        storageObjectName: uploadMetadata?.storageObjectName,
        storageUrl: uploadMetadata?.storageUrl,
        uploadedAt: uploadMetadata?.uploadedAt,
        uploadedByUsername: uploadMetadata?.uploadedByUsername,
        uploadedByIp: uploadMetadata?.uploadedByIp,
        Uploader: {
          connect: {
            where: {
              node: {
                username,
              },
            },
          },
        },
      };
    });

    try {
      const response = await Image.create({
        input: sanitizedInputs as unknown as ImageCreateInput[],
        selectionSet: `{ images ${selectionSet} }`,
      });

      await Promise.all(
        response.images.map((image, index) => {
          const uploadMetadata = uploadMetadataByIndex[index];
          if (!uploadMetadata?.storageObjectName) {
            return Promise.resolve(null);
          }

          return claimUploadAuditMetadata({
            driver: driver || (() => {
              throw new GraphQLError("Upload metadata claim is not configured.");
            })(),
            storageObjectName: uploadMetadata.storageObjectName,
            username,
            claimedByType: "Image",
            claimedById: image.id,
          });
        })
      );

      return response;
    } catch (error: unknown) {
      logger.error("Error creating images:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new GraphQLError(`Failed to create images: ${message}`);
    }
  };
};

export default getResolver;
