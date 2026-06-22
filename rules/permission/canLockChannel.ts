import { rule } from "graphql-shield";
import { hasServerModPermission } from "./hasServerModPermission.js";
import { normalizeServerModPermissionResult } from "./serverModPermissionResult.js";

/**
 * Permission rule that checks if the user has the canLockChannel server mod permission.
 * This is required for locking and unlocking channels.
 */
export const canLockChannel = rule({ cache: "contextual" })(
  async (parent: any, args: any, ctx: any, info: any) => {
    const permissionResult = await hasServerModPermission(
      "canLockChannel",
      ctx
    );

    return normalizeServerModPermissionResult(permissionResult, {
      denyOnFalsy: true,
    });
  }
);
