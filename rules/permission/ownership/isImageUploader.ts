import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../../types/context.js";
import { ERROR_MESSAGES } from "../../errorMessages.js";
import type { ImageWhere } from "../../../src/generated/graphql.js";
import { setUserDataOnContext } from "../userDataHelperFunctions.js";
import { logger } from "../../../logger.js";
import { createContentAuthorizationRepository } from "../../../services/persistence/contentAuthorizationRepository.js";

type IsImageUploaderInput = {
  where: ImageWhere;
};

export const isImageUploader = rule({ cache: "contextual" })(
  async (parent: unknown, args: IsImageUploaderInput, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    const { where } = args;
    const imageId = where?.id?.eq;

    // Set user data
    ctx.user = await setUserDataOnContext({
      context: ctx,
    });

    const username = ctx.user.username;
    if (!imageId) {
      throw new Error(ERROR_MESSAGES.image.noId);
    }
    const repository =
      ctx.contentAuthorizationRepository ??
      createContentAuthorizationRepository(ctx.driver);
    const image = await repository.findImageUploader(imageId);

    logger.info('🔍 isImageUploader - Found image:', JSON.stringify(image, null, 2));

    if (!image.found) {
      throw new Error(ERROR_MESSAGES.image.notFound);
    }
    const uploaderUsername = image.username;

    logger.info('🔍 isImageUploader - Image:', { imageId, uploaderUsername, loggedInUsername: username });

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
