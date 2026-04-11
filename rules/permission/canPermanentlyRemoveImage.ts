import { hasServerModPermission } from "./hasServerModPermission.js";
import { rule } from "graphql-shield";

export interface CanPermanentlyRemoveImageArgs {
  imageId?: string;
}

export const canPermanentlyRemoveImage = rule({ cache: "contextual" })(
  async (
    parent: any,
    args: CanPermanentlyRemoveImageArgs,
    context: any,
    info: any
  ) => {
    // Permanent removal is always server-scoped
    const permissionResult = await hasServerModPermission(
      "canPermanentlyRemoveImage",
      context
    );

    if (permissionResult instanceof Error) {
      return permissionResult;
    }

    return true;
  }
);
