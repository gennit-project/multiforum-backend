import { GraphQLError, type GraphQLResolveInfo } from 'graphql';
import type { Driver } from 'neo4j-driver';
import { setUserDataOnContext } from '../../rules/permission/userDataHelperFunctions.js';
import { ERROR_MESSAGES } from '../../rules/errorMessages.js';
import type { GraphQLContext } from '../../types/context.js';
import type { ImageModel, UserModel } from '../../ogm_types.js';
import { logger } from "../../logger.js";
import {
  claimUploadAuditMetadata,
  getUnclaimedUploadAuditMetadata,
} from "../../services/uploadStorageMetadata.js";
import {
  buildImageVariantPersistenceFields,
  generateImageVariants,
} from "../../services/imageVariants.js";

// Input type for image creation (excluding Uploader since we set it automatically)
type ImageInput = {
  url?: string;
  alt?: string;
  caption?: string;
  longDescription?: string;
  copyright?: string;
  hasSensitiveContent?: boolean;
  hasSpoiler?: boolean;
  albumId?: string;
  storageObjectName?: string;
};

type Args = {
  input: ImageInput;
};

type Input = {
  Image: ImageModel;
  User: UserModel;
  driver?: Driver;
  generateVariants?: typeof generateImageVariants;
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
  const { Image, User, driver, generateVariants = generateImageVariants } = input;

  return async (parent: unknown, args: Args, context: GraphQLContext, info: GraphQLResolveInfo) => {
    const { input: imageInput } = args;

    // Get the logged-in user from context
    context.user = await setUserDataOnContext({
      context,
    });

    const username = context.user?.username;

    if (!username) {
      throw new GraphQLError('You must be logged in to upload images.');
    }

    // Verify the user exists in the database
    const users = await User.find({
      where: { username },
      selectionSet: `{ username }`,
    });

    if (users.length === 0) {
      throw new GraphQLError(ERROR_MESSAGES.image.noUploader);
    }

    const uploadMetadata = imageInput.storageObjectName
      ? await getUnclaimedUploadAuditMetadata({
          driver: driver || (() => {
            throw new GraphQLError("Upload metadata lookup is not configured.");
          })(),
          storageObjectName: imageInput.storageObjectName,
          username,
        })
      : null;

    if (imageInput.storageObjectName && !uploadMetadata) {
      throw new GraphQLError("Upload metadata not found for this image.");
    }

    // Stored list/detail variants are an optimization: an upload whose
    // variants fail to generate still succeeds and falls back to its url.
    let variantFields: ReturnType<typeof buildImageVariantPersistenceFields> = {};
    if (uploadMetadata?.storageBucket && uploadMetadata.storageObjectName) {
      try {
        variantFields = buildImageVariantPersistenceFields(
          await generateVariants({
            storageBucket: uploadMetadata.storageBucket,
            storageObjectName: uploadMetadata.storageObjectName,
          })
        );
      } catch (error) {
        logger.error("Failed to generate image variants:", error);
      }
    }

    // Build the create input with the Uploader relationship
    const createInput: any = {
      url: imageInput.url,
      storageBucket: uploadMetadata?.storageBucket,
      storageObjectName: uploadMetadata?.storageObjectName,
      storageUrl: uploadMetadata?.storageUrl,
      uploadedAt: uploadMetadata?.uploadedAt,
      uploadedByUsername: uploadMetadata?.uploadedByUsername,
      uploadedByIp: uploadMetadata?.uploadedByIp,
      ...variantFields,
      alt: imageInput.alt,
      caption: imageInput.caption,
      longDescription: imageInput.longDescription,
      copyright: imageInput.copyright,
      hasSensitiveContent: imageInput.hasSensitiveContent,
      hasSpoiler: imageInput.hasSpoiler,
      // Connect the Uploader relationship to the logged-in user
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

    // If an albumId is provided, connect the Albums relationship.
    if (imageInput.albumId) {
      createInput.Albums = {
        connect: [
          {
            where: {
              node: {
                id: imageInput.albumId,
              },
            },
          },
        ],
      };
    }

    try {
      const response = await Image.create({
        input: [createInput],
        selectionSet: `{ images ${selectionSet} }`,
      });

      const createdImage = response.images[0];

      if (!createdImage) {
        throw new GraphQLError('Failed to create image.');
      }

      if (uploadMetadata?.storageObjectName) {
        await claimUploadAuditMetadata({
          driver: driver || (() => {
            throw new GraphQLError("Upload metadata claim is not configured.");
          })(),
          storageObjectName: uploadMetadata.storageObjectName,
          username,
          claimedByType: "Image",
          claimedById: createdImage.id,
        });
      }

      return createdImage;
    } catch (error: unknown) {
      logger.error('Error creating image:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new GraphQLError(`Failed to create image: ${message}`);
    }
  };
};

export default getResolver;
