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
  const rootEmail = process.env.SUPERADMIN_EMAIL;
  return Boolean(email) && Boolean(rootEmail) && email === rootEmail;
};
