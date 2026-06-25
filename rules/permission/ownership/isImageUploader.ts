import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../../types/context.js";
import { ERROR_MESSAGES } from "../../errorMessages.js";
import { Image, ImageWhere } from "../../../src/generated/graphql.js";
import { setUserDataOnContext } from "../userDataHelperFunctions.js";
import { logger } from "../../../logger.js";

type IsImageUploaderInput = {
  where: ImageWhere;
};

export const isImageUploader = rule({ cache: "contextual" })(
  async (parent: unknown, args: IsImageUploaderInput, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    const { where } = args;
    const imageId = where?.id;

    // Set user data
    ctx.user = await setUserDataOnContext({
      context: ctx,
    });

    const username = ctx.user.username;
    const ogm = ctx.ogm;

    if (!imageId) {
      throw new Error(ERROR_MESSAGES.image.noId);
    }

    const ImageModel = ogm.model("Image");

    // Get the image and its uploader
    const images: Image[] = await ImageModel.find({
      where: { id: imageId },
      selectionSet: `{
        id
        Uploader {
          username
        }
      }`,
    });

    logger.info('🔍 isImageUploader - Found images:', JSON.stringify(images, null, 2));

    if (!images || images.length === 0) {
      throw new Error(ERROR_MESSAGES.image.notFound);
    }

    const image = images[0];
    const uploaderUsername = image?.Uploader?.username;

    logger.info('🔍 isImageUploader - Image:', { imageId: image.id, uploaderUsername, loggedInUsername: username });

    // If there's no uploader set (legacy/test data), allow anyone authenticated to edit
    // This maintains backward compatibility with existing images
    if (!uploaderUsername) {
      logger.info('⚠️ isImageUploader - No uploader found, allowing edit (legacy data)');
      return true;
    }

    // Check if the user is the uploader
    if (uploaderUsername !== username) {
      logger.info('❌ isImageUploader - User is not the uploader');
      return false; // Permission check - return false to allow OR to work
    }

    logger.info('✅ isImageUploader - User is the uploader');
    return true;
  }
);
