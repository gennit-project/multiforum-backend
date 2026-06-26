import type { GraphQLContext } from "../../types/context.js";
import { isServerRoot } from "./isServerRoot.js";
import { getServerScopedMembership } from "./getServerScopedMembership.js";

/**
 * True when the caller is a server admin (incl. SuperAdmins) or the env
 * break-glass root. This is the override that replaces the per-call-site
 * `isAdmin` in ownership-gated content/channel mutations, so server admins keep
 * their cross-server powers and root can do everything.
 *
 * Deliberately NOT applied to account ownership (isAccountOwner): editing or
 * deleting another user's account is self-only by design (only the invite
 * workflows are cross-user). See docs/isadmin-phaseout-design.md.
 */
export const passesAsServerAdminOrRoot = async (
  ctx: GraphQLContext
): Promise<boolean> => {
  // Resolve membership first: getServerScopedMembership populates ctx.user from
  // the request (email/username) when it isn't set yet. The ownership rules call
  // this BEFORE their own setUserDataOnContext, and isServerRoot reads
  // ctx.user.email — so the root check must run only once identity is resolved,
  // otherwise an env-only root (not in the Admins list) would be missed.
  const { isServerAdmin } = await getServerScopedMembership(ctx);
  if (isServerRoot(ctx)) {
    return true;
  }
  return isServerAdmin;
};
