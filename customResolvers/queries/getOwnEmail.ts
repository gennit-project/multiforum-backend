import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { logger } from "../../logger.js";
import type { AccountRegistrationRepository } from "../../services/persistence/accountRegistrationRepository.js";

type Input = { accountRegistrationRepository: AccountRegistrationRepository };

/**
 * Returns the authenticated caller's OWN account summary, keyed off the
 * verified token email on `context.user.email`. It takes no arguments and
 * never reads a client-supplied address, so it cannot enumerate or look up
 * anyone else's email — that's why the top-level `emails` query is locked down
 * to admins in permissions.ts.
 *
 * Onboarding relies on this: right after Auth0 login a user has a verified
 * email but no account/`username` yet. In that case this resolver still returns
 * a non-null object with `username: null`, letting the frontend distinguish
 * "authenticated but no account" (show username picker) from "not
 * authenticated" (returns null).
 *
 * NOTE: gating this with the `isAuthenticated` shield rule would NOT work,
 * because that rule returns false for queries when there is no username — which
 * is exactly the onboarding case. The self-scoping here is the access control.
 */
const getResolver = (input: Input) => {
  const { accountRegistrationRepository } = input;

  return async (
    _parent: unknown,
    _args: unknown,
    context: GraphQLContext,
    _resolveInfo: GraphQLResolveInfo
  ) => {
    context.user = await setUserDataOnContext({
      context,
    });

    const email = context.user?.email;

    // Not authenticated (no verified email on the token) -> nothing to return.
    if (!email) {
      return null;
    }

    try {
      const rows = await accountRegistrationRepository.findOwnAccountSummary(email);

      const row = rows[0];
      const user = row?.User;

      // Authenticated, but no account/Email node exists yet (pre-onboarding).
      // Return a non-null object with username: null so the frontend can tell
      // "logged in but needs to pick a username" apart from "logged out".
      return {
        address: row?.address ?? email,
        username: user?.username ?? null,
        profilePicURL: user?.profilePicURL ?? null,
        modProfileName: user?.ModerationProfile?.displayName ?? null,
        unreadNotificationCount: user?.NotificationsConnection?.aggregate?.count?.nodes ?? null,
      };
    } catch (error) {
      logger.error("Error in getOwnEmail resolver:", error);
      throw new Error(
        `Failed to get own email: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };
};

export default getResolver;
