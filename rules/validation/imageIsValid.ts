import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import {
  getAttemptedUploadAuditFields,
  uploadAuditFieldsError,
} from "./uploadAuditFields.js";
import {
  getAttemptedImageVariantFields,
  imageVariantFieldsError,
} from "./variantFieldUpdates.js";

type UpdateImageArgs = {
  update?: Record<string, unknown> | null;
};

export const updateImageInputIsValid = rule({ cache: "contextual" })(
  async (
    _parent: unknown,
    args: UpdateImageArgs,
    _ctx: GraphQLContext,
    _info: GraphQLResolveInfo
  ) => {
    const attemptedUploadAuditFields = getAttemptedUploadAuditFields(args.update);

    if (attemptedUploadAuditFields.length > 0) {
      return uploadAuditFieldsError(attemptedUploadAuditFields);
    }

    const attemptedImageVariantFields = getAttemptedImageVariantFields(
      args.update
    );

    if (attemptedImageVariantFields.length > 0) {
      return imageVariantFieldsError(attemptedImageVariantFields);
    }

    return true;
  }
);
