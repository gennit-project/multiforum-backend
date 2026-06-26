// Server-scoped and miscellaneous graphql-shield rules.
// Extracted from rules/rules.ts.
import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import type { ServerRole, ModServerRole } from "../../ogm_types.js";
import { hasServerPermission } from "../permission/hasServerPermission.js";
import { hasServerModPermission } from "../permission/hasServerModPermission.js";
import { isServerRoot } from "../permission/isServerRoot.js";

// The env break-glass root (and the test super-user) only. Used for the
// dangerous Cypress test-data mutations, which must never be a delegatable
// capability. See docs/isadmin-phaseout-design.md.
export const isRoot = rule({ cache: "contextual" })(
  async (_parent: unknown, _args: unknown, ctx: GraphQLContext, _info: GraphQLResolveInfo) =>
    isServerRoot(ctx)
);

// Factories for capability-named server rules (the isAdmin phase-out). Each
// wraps the generic permission evaluator, so the rule passes when the caller's
// tier role grants the capability (and for the env break-glass root). See
// docs/isadmin-phaseout-design.md.
const serverPermissionRule = (permission: keyof ServerRole) =>
  rule({ cache: "contextual" })(
    async (_parent: unknown, _args: unknown, ctx: GraphQLContext, _info: GraphQLResolveInfo) => {
      const result = await hasServerPermission(permission, ctx);
      if (!result) return false;
      if (result instanceof Error) return result;
      return true;
    }
  );

const serverModPermissionRule = (permission: keyof ModServerRole) =>
  rule({ cache: "contextual" })(
    async (_parent: unknown, _args: unknown, ctx: GraphQLContext, _info: GraphQLResolveInfo) => {
      const result = await hasServerModPermission(permission, ctx);
      if (!result) return false;
      if (result instanceof Error) return result;
      return true;
    }
  );

// Server-administration capabilities (ServerRole, "creative").
export const canManageServerSettings = serverPermissionRule("canManageServerSettings");
export const canManagePlugins = serverPermissionRule("canManagePlugins");
export const canManageRoles = serverPermissionRule("canManageRoles");
export const canManageMods = serverPermissionRule("canManageMods");
export const canManageAdmins = serverPermissionRule("canManageAdmins");
export const canManageSuperAdmins = serverPermissionRule("canManageSuperAdmins");

// Destructive structural removals (ModServerRole).
export const canRemoveDiscussionChannel = serverModPermissionRule("canRemoveDiscussionChannel");
export const canRemoveEventChannel = serverModPermissionRule("canRemoveEventChannel");

// Server-scoped reporting (e.g. profile pictures, which have no channel to scope
// to). Covered for server admins via the hasServerModPermission shortcut.
export const canReportServerContent = serverModPermissionRule("canReport");

export const canUploadFile = rule({ cache: "contextual" })(
  async (parent: unknown, args: unknown, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    const permissionResult = await hasServerPermission(
      "canUploadFile",
      ctx
    );

    if (!permissionResult) {
      return false;
    }

    if (permissionResult instanceof Error) {
      return permissionResult;
    }

    return true;
  }
);

export const canGiveFeedback = rule({ cache: "contextual" })(
  async (parent: unknown, args: unknown, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    const permissionResult = await hasServerModPermission(
      "canGiveFeedback",
      ctx
    );

    if (!permissionResult) {
      return false;
    }

    if (permissionResult instanceof Error) {
      return permissionResult;
    }

    return true;
  }
);

export const canReportContent = rule({ cache: "contextual" })(
  async (parent: unknown, args: unknown, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    // Placeholder rule for now

    return true;
  }
);

export const issueIsValid = rule({ cache: "contextual" })(
  async (parent: unknown, args: unknown, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    return true;
  }
);
