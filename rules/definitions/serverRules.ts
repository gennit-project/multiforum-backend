// Server-scoped and miscellaneous graphql-shield rules.
// Extracted from rules/rules.ts.
import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import { hasServerPermission } from "../permission/hasServerPermission.js";
import { hasServerModPermission } from "../permission/hasServerModPermission.js";
import { getServerScopedMembership } from "../permission/getServerScopedMembership.js";

export const isAdmin = rule({ cache: "contextual" })(
  async (parent: unknown, args: unknown, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    const membership = await getServerScopedMembership(ctx);
    return membership.isServerAdmin;
  }
);

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
