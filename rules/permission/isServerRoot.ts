import type { GraphQLContext } from "../../types/context.js";

/**
 * The break-glass root identity for self-hosting. It is env-defined
 * (`SUPERADMIN_EMAIL`), immutable from the database, and holds every capability
 * unconditionally. Its jobs are to seed the first SuperAdmin on a fresh install
 * and to recover if `ServerConfig.SuperAdmins` is ever emptied/misconfigured.
 * See docs/isadmin-phaseout-design.md.
 *
 * Matches on the verified token email already on `context.user.email`.
 */
export const isServerRoot = (context: GraphQLContext): boolean => {
  const email = context.user?.email;
  if (!email) {
    return false;
  }
  // Production break-glass root.
  if (process.env.SUPERADMIN_EMAIL && email === process.env.SUPERADMIN_EMAIL) {
    return true;
  }
  // Test super-user: the Cypress/E2E admin email is the root-equivalent in test
  // environments (it already grants isServerAdmin via getServerScopedMembership).
  // Only set in test/CI, never production, so it cannot escalate a real server.
  if (
    process.env.CYPRESS_ADMIN_TEST_EMAIL &&
    email === process.env.CYPRESS_ADMIN_TEST_EMAIL
  ) {
    return true;
  }
  return false;
};
