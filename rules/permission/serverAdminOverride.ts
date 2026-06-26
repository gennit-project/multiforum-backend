import type { GraphQLContext } from "../../types/context.js";
import { isServerRoot } from "./isServerRoot.js";
import { getServerScopedMembership } from "./getServerScopedMembership.js";
import { getActiveServerSuspension } from "./getActiveServerSuspension.js";

// --- Pure decision (extracted for unit testing) ---

/**
 * Decides whether the caller passes an owner/channel check purely on the
 * strength of being server staff.
 *
 * - The env break-glass root always passes (suspension can never stop root).
 * - A server admin (incl. SuperAdmins) passes UNLESS they are server-suspended,
 *   in which case they lose the blanket override and fall through to the normal
 *   (restricted) role checks. This mirrors hasServerPermission, where "suspension
 *   takes precedence over tier". Server suspension is the lever that restricts an
 *   admin; root is the only actor it cannot stop.
 */
export function evaluateAdminOverride(input: {
  isRoot: boolean;
  isServerAdmin: boolean;
  isServerSuspended: boolean;
}): boolean {
  const { isRoot, isServerAdmin, isServerSuspended } = input;
  if (isRoot) {
    return true;
  }
  if (!isServerAdmin) {
    return false;
  }
  return !isServerSuspended;
}

/**
 * True when the caller is the env break-glass root, or a server admin (incl.
 * SuperAdmins) who is not server-suspended. This is the override that replaces
 * the per-call-site `isAdmin` in ownership-gated content/channel mutations, so
 * server admins keep their cross-server powers and root can do everything.
 *
 * Deliberately NOT applied to account ownership (isAccountOwner): editing or
 * deleting another user's account is self-only by design (only the invite
 * workflows are cross-user). See docs/isadmin-phaseout-design.md.
 */
export const passesAsServerAdminOrRoot = async (
  ctx: GraphQLContext
): Promise<boolean> => {
  // Root passes unconditionally; resolve it first so it never pays for the
  // membership/suspension lookups.
  if (isServerRoot(ctx)) {
    return true;
  }

  // getServerScopedMembership populates ctx.user from the request (email/
  // username) when it isn't set yet. The ownership rules call this BEFORE their
  // own setUserDataOnContext, so identity must be resolved here.
  const { isServerAdmin } = await getServerScopedMembership(ctx);
  if (!isServerAdmin) {
    return false;
  }

  // Only an admin reaches the (more expensive) server-suspension lookup. A
  // server-suspended admin loses the override and falls through to the normal
  // role checks at the call site.
  const username = ctx.user?.username ?? undefined;
  if (!username) {
    return false;
  }
  const suspension = await getActiveServerSuspension({ context: ctx, username });

  return evaluateAdminOverride({
    isRoot: false,
    isServerAdmin,
    isServerSuspended: suspension.isSuspended,
  });
};
