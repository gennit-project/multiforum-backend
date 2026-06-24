import { hasServerModPermission } from "./hasServerModPermission.js";
import { normalizeServerModPermissionResult } from "./serverModPermissionResult.js";
import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";

export interface CanPermanentlyRemoveImageArgs {
  imageId?: string;
}

export const canPermanentlyRemoveImage = rule({ cache: "contextual" })(
  async (
    parent: unknown,
    args: CanPermanentlyRemoveImageArgs,
    context: GraphQLContext,
    info: GraphQLResolveInfo
  ) => {
    // Permanent removal is always server-scoped
    const permissionResult = await hasServerModPermission(
      "canPermanentlyRemoveImage",
      context
    );

    return normalizeServerModPermissionResult(permissionResult);
  }
);
